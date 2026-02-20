import SwaggerParser from '@apidevtools/swagger-parser';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  format?: string;
  nullable?: boolean;
  minLength?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
};

type OperationResponse = {
  content?: {
    'application/json'?: {
      schema?: JsonSchema;
    };
  };
};

type OperationContract = {
  operationId?: string;
  responses?: Record<string, OperationResponse>;
};

export type OpenApiProviderContract = {
  paths: Record<string, Partial<Record<HttpMethod, OperationContract>>>;
};

export async function loadOpenApiProviderContract(contractPath: string): Promise<OpenApiProviderContract> {
  const dereferenced = await SwaggerParser.dereference(contractPath);
  return dereferenced as OpenApiProviderContract;
}

export function getDeclaredResponseStatusCodes(
  contract: OpenApiProviderContract,
  routePath: string,
  method: HttpMethod
): number[] {
  const operation = getOperationContract(contract, routePath, method);
  return Object.keys(operation.responses ?? {})
    .filter((status) => /^[0-9]{3}$/.test(status))
    .map((status) => Number.parseInt(status, 10))
    .sort((left, right) => left - right);
}

export function assertJsonResponseMatchesContract(input: {
  contract: OpenApiProviderContract;
  routePath: string;
  method: HttpMethod;
  status: number;
  body: unknown;
}): void {
  const operation = getOperationContract(input.contract, input.routePath, input.method);
  const operationName = operation.operationId ?? `${input.method.toUpperCase()} ${input.routePath}`;
  const responses = operation.responses ?? {};
  const statusKey = String(input.status);
  const responseContract = responses[statusKey];

  if (!responseContract) {
    const declaredStatuses = Object.keys(responses).sort().join(', ');
    throw new Error(
      `[contract:${operationName}] status ${input.status} is not declared for ${input.method.toUpperCase()} ${input.routePath}. Declared statuses: ${declaredStatuses || 'none'}.`
    );
  }

  const jsonSchema = responseContract.content?.['application/json']?.schema;
  if (!jsonSchema) {
    return;
  }

  const violations: string[] = [];
  validateSchema(jsonSchema, input.body, 'response.body', violations);

  if (violations.length > 0) {
    throw new Error(`[contract:${operationName}] schema violations:\n- ${violations.join('\n- ')}`);
  }
}

function getOperationContract(
  contract: OpenApiProviderContract,
  routePath: string,
  method: HttpMethod
): OperationContract {
  const pathItem = contract.paths[routePath];
  if (!pathItem) {
    throw new Error(`[contract] missing path definition: ${routePath}`);
  }

  const operation = pathItem[method];
  if (!operation) {
    throw new Error(`[contract] missing operation definition: ${method.toUpperCase()} ${routePath}`);
  }

  return operation;
}

function validateSchema(schema: JsonSchema, value: unknown, fieldPath: string, violations: string[]): void {
  if (schema.nullable && value === null) {
    return;
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const validOneOf = schema.oneOf.some((candidate) => {
      const candidateViolations: string[] = [];
      validateSchema(candidate, value, fieldPath, candidateViolations);
      return candidateViolations.length === 0;
    });

    if (!validOneOf) {
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
      validateObjectSchema(schema, value, fieldPath, violations);
      return;
    case 'array':
      validateArraySchema(schema, value, fieldPath, violations);
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
      validateSchema(propertySchema, objectValue[propertyName], `${fieldPath}.${propertyName}`, violations);
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
    validateSchema(schema.items as JsonSchema, item, `${fieldPath}[${index}]`, violations);
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

  if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
    violations.push(`${fieldPath} must be a valid RFC3339 date-time string`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
