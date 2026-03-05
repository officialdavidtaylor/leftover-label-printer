import fs from 'node:fs/promises';

import yaml from 'js-yaml';
import { z } from 'zod';

type JsonSchema = {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  nullable?: boolean;
  minLength?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
};

type AsyncApiMessage = {
  payload?: JsonSchema;
};

type AsyncApiChannel = {
  publish?: {
    message?: JsonSchema | { $ref?: string; oneOf?: Array<{ $ref?: string }> };
  };
};

export type AsyncApiContract = {
  channels: Record<string, AsyncApiChannel>;
  components: {
    messages: Record<string, AsyncApiMessage>;
    schemas: Record<string, JsonSchema>;
  };
};

const asyncApiContractSchema = z
  .object({
    channels: z.record(
      z.string(),
      z
        .object({
          publish: z
            .object({
              message: z.unknown().optional(),
            })
            .optional(),
        })
        .passthrough()
    ),
    components: z
      .object({
        messages: z.record(z.string(), z.object({ payload: z.unknown().optional() }).passthrough()),
        schemas: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

const refObjectSchema = z.object({ $ref: z.string() }).passthrough();
const oneOfRefObjectSchema = z
  .object({
    oneOf: z.array(z.object({ $ref: z.string().optional() }).passthrough()),
  })
  .passthrough();

export async function loadAsyncApiContract(contractPath: string): Promise<AsyncApiContract> {
  const contractText = await fs.readFile(contractPath, 'utf8');
  const parsed = yaml.load(contractText);
  return asyncApiContractSchema.parse(parsed) as AsyncApiContract;
}

export function getPublishPayloadSchema(
  contract: AsyncApiContract,
  channelName: string
): JsonSchema {
  const channel = contract.channels[channelName];
  if (!channel?.publish?.message) {
    throw new Error(`[contract] missing publish.message for channel ${channelName}`);
  }

  const publishMessage = channel.publish.message;
  const refMessage = refObjectSchema.safeParse(publishMessage);
  if (refMessage.success) {
    const resolvedMessage = resolveLocalRef(contract, refMessage.data.$ref) as AsyncApiMessage;
    return resolveSchema(contract, resolvedMessage.payload);
  }

  const oneOfRefMessage = oneOfRefObjectSchema.safeParse(publishMessage);
  if (oneOfRefMessage.success) {
    if (oneOfRefMessage.data.oneOf.length !== 1 || !oneOfRefMessage.data.oneOf[0]?.$ref) {
      throw new Error(`[contract] expected exactly one $ref for channel ${channelName} publish message`);
    }
    const resolvedMessage = resolveLocalRef(
      contract,
      oneOfRefMessage.data.oneOf[0].$ref
    ) as AsyncApiMessage;
    return resolveSchema(contract, resolvedMessage.payload);
  }

  return resolveSchema(contract, publishMessage.payload);
}

export function assertMatchesJsonSchema(input: {
  contract: AsyncApiContract;
  schema: JsonSchema;
  value: unknown;
  subject: string;
}): void {
  const violations: string[] = [];
  validateSchema(input.contract, input.schema, input.value, input.subject, violations);

  if (violations.length > 0) {
    throw new Error(`[contract] schema violations:\n- ${violations.join('\n- ')}`);
  }
}

function validateSchema(
  contract: AsyncApiContract,
  schema: JsonSchema,
  value: unknown,
  fieldPath: string,
  violations: string[]
): void {
  if (schema.$ref) {
    validateSchema(contract, resolveLocalRef(contract, schema.$ref) as JsonSchema, value, fieldPath, violations);
    return;
  }

  if (schema.nullable && value === null) {
    return;
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const validCandidate = schema.oneOf.some((candidate) => {
      const candidateViolations: string[] = [];
      validateSchema(contract, candidate, value, fieldPath, candidateViolations);
      return candidateViolations.length === 0;
    });

    if (!validCandidate) {
      violations.push(`${fieldPath} does not match any allowed oneOf schema`);
    }
    return;
  }

  if (schema.enum && schema.enum.length > 0 && !schema.enum.includes(value)) {
    violations.push(`${fieldPath} must be one of [${schema.enum.join(', ')}]`);
    return;
  }

  switch (schema.type) {
    case 'object':
      validateObjectSchema(contract, schema, value, fieldPath, violations);
      return;
    case 'array':
      validateArraySchema(contract, schema, value, fieldPath, violations);
      return;
    case 'string':
      validateStringSchema(schema, value, fieldPath, violations);
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        violations.push(`${fieldPath} must be an integer`);
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        violations.push(`${fieldPath} must be a finite number`);
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        violations.push(`${fieldPath} must be a boolean`);
      }
      return;
    default:
      return;
  }
}

function validateObjectSchema(
  contract: AsyncApiContract,
  schema: JsonSchema,
  value: unknown,
  fieldPath: string,
  violations: string[]
): void {
  if (!isPlainObject(value)) {
    violations.push(`${fieldPath} must be an object`);
    return;
  }

  const objectValue = value as Record<string, unknown>;
  for (const requiredField of schema.required ?? []) {
    if (!(requiredField in objectValue)) {
      violations.push(`${fieldPath}.${requiredField} is required`);
    }
  }

  for (const [propertyName, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (propertyName in objectValue) {
      validateSchema(contract, propertySchema, objectValue[propertyName], `${fieldPath}.${propertyName}`, violations);
    }
  }

  if (schema.additionalProperties === false) {
    const knownProperties = new Set(Object.keys(schema.properties ?? {}));
    for (const propertyName of Object.keys(objectValue)) {
      if (!knownProperties.has(propertyName)) {
        violations.push(`${fieldPath}.${propertyName} is not allowed`);
      }
    }
  }
}

function validateArraySchema(
  contract: AsyncApiContract,
  schema: JsonSchema,
  value: unknown,
  fieldPath: string,
  violations: string[]
): void {
  if (!Array.isArray(value)) {
    violations.push(`${fieldPath} must be an array`);
    return;
  }

  if (!schema.items) {
    return;
  }

  value.forEach((item, index) => {
    validateSchema(contract, schema.items as JsonSchema, item, `${fieldPath}[${index}]`, violations);
  });
}

function validateStringSchema(
  schema: JsonSchema,
  value: unknown,
  fieldPath: string,
  violations: string[]
): void {
  if (typeof value !== 'string') {
    violations.push(`${fieldPath} must be a string`);
    return;
  }

  if (schema.minLength !== undefined && value.length < schema.minLength) {
    violations.push(`${fieldPath} must have at least ${schema.minLength} characters`);
  }

  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    violations.push(`${fieldPath} must match pattern ${schema.pattern}`);
  }

  if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
    violations.push(`${fieldPath} must be a valid RFC3339 date-time string`);
  }

  if (schema.format === 'uri') {
    try {
      new URL(value);
    } catch {
      violations.push(`${fieldPath} must be a valid URI`);
    }
  }
}

function resolveSchema(contract: AsyncApiContract, schema: JsonSchema | undefined): JsonSchema {
  if (!schema) {
    throw new Error('[contract] missing payload schema');
  }
  if (!schema.$ref) {
    return schema;
  }

  return resolveLocalRef(contract, schema.$ref) as JsonSchema;
}

function resolveLocalRef(contract: AsyncApiContract, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`[contract] unsupported ref: ${ref}`);
  }

  const pointerPath = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = contract;
  for (const segment of pointerPath) {
    if (!isPlainObject(current) || !(segment in current)) {
      throw new Error(`[contract] unable to resolve ref: ${ref}`);
    }
    current = current[segment];
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
