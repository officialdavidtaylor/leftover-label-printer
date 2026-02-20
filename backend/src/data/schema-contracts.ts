import { z } from 'zod';

export const PRINT_JOB_STATES = [
  'pending',
  'processing',
  'dispatched',
  'printed',
  'failed',
] as const;

export type PrintJobState = (typeof PRINT_JOB_STATES)[number];

export const JOB_EVENT_SOURCES = ['backend', 'agent'] as const;
export type JobEventSource = (typeof JOB_EVENT_SOURCES)[number];

export const PRINTER_STATUSES = ['online', 'offline', 'degraded', 'unknown'] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

export const TEMPLATE_STATUSES = ['active', 'inactive', 'deprecated'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

const nonEmptyStringSchema = z.string().trim().min(1);
const isoTimestampSchema = nonEmptyStringSchema.refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'expected ISO-8601 timestamp',
});
const jsonObjectSchema = z.record(z.string(), z.unknown());

const printJobStateSchema = z.enum(PRINT_JOB_STATES);
const jobEventSourceSchema = z.enum(JOB_EVENT_SOURCES);
const printerStatusSchema = z.enum(PRINTER_STATUSES);
const templateStatusSchema = z.enum(TEMPLATE_STATUSES);
const jobEventOutcomeSchema = z.enum(['printed', 'failed']);

export const printJobDocumentSchema = z.object({
  jobId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  state: printJobStateSchema,
  printerId: nonEmptyStringSchema,
  templateId: nonEmptyStringSchema,
  templateVersion: nonEmptyStringSchema.optional(),
  payload: jsonObjectSchema,
  traceId: nonEmptyStringSchema,
  acceptedAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const jobEventDocumentSchema = z
  .object({
    eventId: nonEmptyStringSchema,
    jobId: nonEmptyStringSchema,
    type: printJobStateSchema,
    source: jobEventSourceSchema,
    occurredAt: isoTimestampSchema,
    traceId: nonEmptyStringSchema,
    printerId: nonEmptyStringSchema.optional(),
    outcome: jobEventOutcomeSchema.optional(),
    errorCode: nonEmptyStringSchema.optional(),
    errorMessage: nonEmptyStringSchema.optional(),
  })
  .superRefine((document, ctx) => {
    const backendAllowedEvents = new Set<PrintJobState>(['pending', 'processing', 'dispatched']);
    const agentAllowedEvents = new Set<PrintJobState>(['printed', 'failed']);

    if (document.source === 'backend' && !backendAllowedEvents.has(document.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'backend source can only emit pending, processing, or dispatched events',
      });
    }

    if (document.source === 'agent') {
      if (!agentAllowedEvents.has(document.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['type'],
          message: 'agent source can only emit printed or failed events',
        });
      }

      if (!document.printerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['printerId'],
          message: 'printerId is required for agent events',
        });
      }

      if (!document.outcome) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outcome'],
          message: 'outcome is required for agent events',
        });
      }

      if (document.outcome && document.outcome !== document.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outcome'],
          message: 'outcome must match event type for agent terminal events',
        });
      }
    }

    if (document.type === 'failed') {
      if (!document.errorCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['errorCode'],
          message: 'errorCode is required for failed events',
        });
      }

      if (!document.errorMessage) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['errorMessage'],
          message: 'errorMessage is required for failed events',
        });
      }
    }
  });

export const printerDocumentSchema = z.object({
  printerId: nonEmptyStringSchema,
  nodeId: nonEmptyStringSchema,
  status: printerStatusSchema,
  capabilities: jsonObjectSchema,
  metadata: jsonObjectSchema.optional(),
  lastSeenAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const templateDocumentSchema = z.object({
  templateId: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  schemaVersion: nonEmptyStringSchema,
  renderEngine: nonEmptyStringSchema,
  status: templateStatusSchema,
  config: jsonObjectSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export type PrintJobDocument = z.infer<typeof printJobDocumentSchema>;
export type JobEventDocument = z.infer<typeof jobEventDocumentSchema>;
export type PrinterDocument = z.infer<typeof printerDocumentSchema>;
export type TemplateDocument = z.infer<typeof templateDocumentSchema>;

export type CollectionContract = {
  name: 'print_jobs' | 'job_events' | 'printers' | 'templates';
  writeModel: 'mutable' | 'append_only';
  requiredFields: readonly string[];
};

export const COLLECTION_CONTRACTS: readonly CollectionContract[] = [
  {
    name: 'print_jobs',
    writeModel: 'mutable',
    requiredFields: [
      'jobId',
      'idempotencyKey',
      'state',
      'printerId',
      'templateId',
      'payload',
      'traceId',
      'acceptedAt',
      'createdAt',
      'updatedAt',
    ],
  },
  {
    name: 'job_events',
    writeModel: 'append_only',
    requiredFields: ['eventId', 'jobId', 'type', 'source', 'occurredAt', 'traceId'],
  },
  {
    name: 'printers',
    writeModel: 'mutable',
    requiredFields: [
      'printerId',
      'nodeId',
      'status',
      'capabilities',
      'lastSeenAt',
      'createdAt',
      'updatedAt',
    ],
  },
  {
    name: 'templates',
    writeModel: 'mutable',
    requiredFields: [
      'templateId',
      'version',
      'name',
      'schemaVersion',
      'renderEngine',
      'status',
      'config',
      'createdAt',
      'updatedAt',
    ],
  },
];

export type ValidationFailure = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { valid: true; document: T }
  | { valid: false; failures: ValidationFailure[] };

export type ValidationFailureLog = {
  level: 'warn';
  event: 'schema_validation_failed';
  collection: CollectionContract['name'];
  traceId?: string;
  failures: ValidationFailure[];
};

export type PrintJobAcceptedResponse = {
  jobId: string;
  state: PrintJobState;
  acceptedAt: string;
  traceId: string;
};

export type PrintJobStatusResponse = {
  jobId: string;
  state: PrintJobState;
  printerId: string;
  templateId: string;
  templateVersion?: string;
  events: JobEventDocument[];
};

// Canonical sample documents are intentionally centralized in docs/data-schemas.md.
export function validatePrintJobDocument(value: unknown): ValidationResult<PrintJobDocument> {
  return toValidationResult(printJobDocumentSchema.safeParse(value));
}

export function validateJobEventDocument(value: unknown): ValidationResult<JobEventDocument> {
  return toValidationResult(jobEventDocumentSchema.safeParse(value));
}

export function validatePrinterDocument(value: unknown): ValidationResult<PrinterDocument> {
  return toValidationResult(printerDocumentSchema.safeParse(value));
}

export function validateTemplateDocument(value: unknown): ValidationResult<TemplateDocument> {
  return toValidationResult(templateDocumentSchema.safeParse(value));
}

export function toPrintJobAcceptedResponse(job: PrintJobDocument): PrintJobAcceptedResponse {
  return {
    jobId: job.jobId,
    state: job.state,
    acceptedAt: job.acceptedAt,
    traceId: job.traceId,
  };
}

export function toPrintJobStatusResponse(
  job: PrintJobDocument,
  events: readonly JobEventDocument[]
): PrintJobStatusResponse {
  return {
    jobId: job.jobId,
    state: job.state,
    printerId: job.printerId,
    templateId: job.templateId,
    ...(job.templateVersion ? { templateVersion: job.templateVersion } : {}),
    events: [...events],
  };
}

export function buildSchemaValidationFailureLog(
  collection: CollectionContract['name'],
  result: ValidationResult<unknown>,
  traceId?: string
): ValidationFailureLog | null {
  if (result.valid) {
    return null;
  }

  return {
    level: 'warn',
    event: 'schema_validation_failed',
    collection,
    ...(traceId ? { traceId } : {}),
    failures: result.failures,
  };
}

function toValidationResult<T>(
  result:
    | { success: true; data: T }
    | {
        success: false;
        error: z.ZodError<T>;
      }
): ValidationResult<T> {
  if (result.success) {
    return { valid: true, document: result.data };
  }

  return {
    valid: false,
    failures: result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? String(issue.path[0]) : '$',
      message: issue.message,
    })),
  };
}
