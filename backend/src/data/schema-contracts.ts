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

export type PrintJobDocument = {
  jobId: string;
  idempotencyKey: string;
  state: PrintJobState;
  printerId: string;
  templateId: string;
  templateVersion?: string;
  payload: Record<string, unknown>;
  traceId: string;
  acceptedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type JobEventDocument = {
  eventId: string;
  jobId: string;
  type: PrintJobState;
  source: JobEventSource;
  occurredAt: string;
  traceId: string;
  printerId?: string;
  outcome?: 'printed' | 'failed';
  errorCode?: string;
  errorMessage?: string;
};

export type PrinterDocument = {
  printerId: string;
  nodeId: string;
  status: PrinterStatus;
  capabilities: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateDocument = {
  templateId: string;
  version: string;
  name: string;
  schemaVersion: string;
  renderEngine: string;
  status: TemplateStatus;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

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

export const EXAMPLE_PRINT_JOB_DOCUMENT: PrintJobDocument = {
  jobId: 'job-7f669920',
  idempotencyKey: 'idem-7f669920',
  state: 'pending',
  printerId: 'printer-east-1',
  templateId: 'label-default',
  templateVersion: 'v1',
  payload: {
    itemName: 'Lemon Bars',
    prepDate: '2026-02-20',
    expirationDate: '2026-02-24',
  },
  traceId: 'trace-a9e6141a',
  acceptedAt: '2026-02-20T15:00:00.000Z',
  createdAt: '2026-02-20T15:00:00.000Z',
  updatedAt: '2026-02-20T15:00:00.000Z',
};

export const EXAMPLE_JOB_EVENT_DOCUMENT: JobEventDocument = {
  eventId: 'event-b6db3543',
  jobId: 'job-7f669920',
  type: 'pending',
  source: 'backend',
  occurredAt: '2026-02-20T15:00:00.000Z',
  traceId: 'trace-a9e6141a',
};

export const EXAMPLE_PRINTER_DOCUMENT: PrinterDocument = {
  printerId: 'printer-east-1',
  nodeId: 'node-east-1',
  status: 'online',
  capabilities: {
    model: 'Brother QL-820NWB',
    media: ['62mm'],
  },
  metadata: {
    location: 'Prep Kitchen',
  },
  lastSeenAt: '2026-02-20T14:59:10.000Z',
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-20T14:59:10.000Z',
};

export const EXAMPLE_TEMPLATE_DOCUMENT: TemplateDocument = {
  templateId: 'label-default',
  version: 'v1',
  name: 'Default Leftover Label',
  schemaVersion: '1.0.0',
  renderEngine: 'pdfkit',
  status: 'active',
  config: {
    pageSize: '62mmx100mm',
    locale: 'en-US',
  },
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-20T12:30:00.000Z',
};

export function validatePrintJobDocument(value: unknown): ValidationResult<PrintJobDocument> {
  const failures: ValidationFailure[] = [];

  const document = asRecord(value, failures, '$');
  if (!document) {
    return invalid(failures);
  }

  const jobId = getRequiredString(document, 'jobId', failures);
  const idempotencyKey = getRequiredString(document, 'idempotencyKey', failures);
  const state = getRequiredEnum(document, 'state', PRINT_JOB_STATES, failures);
  const printerId = getRequiredString(document, 'printerId', failures);
  const templateId = getRequiredString(document, 'templateId', failures);
  const templateVersion = getOptionalString(document, 'templateVersion', failures);
  const payload = getRequiredRecord(document, 'payload', failures);
  const traceId = getRequiredString(document, 'traceId', failures);
  const acceptedAt = getRequiredIsoTimestamp(document, 'acceptedAt', failures);
  const createdAt = getRequiredIsoTimestamp(document, 'createdAt', failures);
  const updatedAt = getRequiredIsoTimestamp(document, 'updatedAt', failures);

  if (failures.length > 0) {
    return invalid(failures);
  }

  return {
    valid: true,
    document: {
      jobId,
      idempotencyKey,
      state,
      printerId,
      templateId,
      ...(templateVersion ? { templateVersion } : {}),
      payload,
      traceId,
      acceptedAt,
      createdAt,
      updatedAt,
    },
  };
}

export function validateJobEventDocument(value: unknown): ValidationResult<JobEventDocument> {
  const failures: ValidationFailure[] = [];

  const document = asRecord(value, failures, '$');
  if (!document) {
    return invalid(failures);
  }

  const eventId = getRequiredString(document, 'eventId', failures);
  const jobId = getRequiredString(document, 'jobId', failures);
  const type = getRequiredEnum(document, 'type', PRINT_JOB_STATES, failures);
  const source = getRequiredEnum(document, 'source', JOB_EVENT_SOURCES, failures);
  const occurredAt = getRequiredIsoTimestamp(document, 'occurredAt', failures);
  const traceId = getRequiredString(document, 'traceId', failures);
  const printerId = getOptionalString(document, 'printerId', failures);
  const outcome = getOptionalEnum(document, 'outcome', ['printed', 'failed'] as const, failures);
  const errorCode = getOptionalString(document, 'errorCode', failures);
  const errorMessage = getOptionalString(document, 'errorMessage', failures);

  const backendAllowedEvents = new Set<PrintJobState>(['pending', 'processing', 'dispatched']);
  const agentAllowedEvents = new Set<PrintJobState>(['printed', 'failed']);

  if (source === 'backend' && !backendAllowedEvents.has(type)) {
    failures.push({
      field: 'type',
      message: 'backend source can only emit pending, processing, or dispatched events',
    });
  }

  if (source === 'agent') {
    if (!agentAllowedEvents.has(type)) {
      failures.push({
        field: 'type',
        message: 'agent source can only emit printed or failed events',
      });
    }

    if (!printerId) {
      failures.push({
        field: 'printerId',
        message: 'printerId is required for agent events',
      });
    }

    if (!outcome) {
      failures.push({
        field: 'outcome',
        message: 'outcome is required for agent events',
      });
    }

    if (outcome && outcome !== type) {
      failures.push({
        field: 'outcome',
        message: 'outcome must match event type for agent terminal events',
      });
    }
  }

  if (type === 'failed') {
    if (!errorCode) {
      failures.push({
        field: 'errorCode',
        message: 'errorCode is required for failed events',
      });
    }

    if (!errorMessage) {
      failures.push({
        field: 'errorMessage',
        message: 'errorMessage is required for failed events',
      });
    }
  }

  if (failures.length > 0) {
    return invalid(failures);
  }

  return {
    valid: true,
    document: {
      eventId,
      jobId,
      type,
      source,
      occurredAt,
      traceId,
      ...(printerId ? { printerId } : {}),
      ...(outcome ? { outcome } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    },
  };
}

export function validatePrinterDocument(value: unknown): ValidationResult<PrinterDocument> {
  const failures: ValidationFailure[] = [];

  const document = asRecord(value, failures, '$');
  if (!document) {
    return invalid(failures);
  }

  const printerId = getRequiredString(document, 'printerId', failures);
  const nodeId = getRequiredString(document, 'nodeId', failures);
  const status = getRequiredEnum(document, 'status', PRINTER_STATUSES, failures);
  const capabilities = getRequiredRecord(document, 'capabilities', failures);
  const metadata = getOptionalRecord(document, 'metadata', failures);
  const lastSeenAt = getRequiredIsoTimestamp(document, 'lastSeenAt', failures);
  const createdAt = getRequiredIsoTimestamp(document, 'createdAt', failures);
  const updatedAt = getRequiredIsoTimestamp(document, 'updatedAt', failures);

  if (failures.length > 0) {
    return invalid(failures);
  }

  return {
    valid: true,
    document: {
      printerId,
      nodeId,
      status,
      capabilities,
      ...(metadata ? { metadata } : {}),
      lastSeenAt,
      createdAt,
      updatedAt,
    },
  };
}

export function validateTemplateDocument(value: unknown): ValidationResult<TemplateDocument> {
  const failures: ValidationFailure[] = [];

  const document = asRecord(value, failures, '$');
  if (!document) {
    return invalid(failures);
  }

  const templateId = getRequiredString(document, 'templateId', failures);
  const version = getRequiredString(document, 'version', failures);
  const name = getRequiredString(document, 'name', failures);
  const schemaVersion = getRequiredString(document, 'schemaVersion', failures);
  const renderEngine = getRequiredString(document, 'renderEngine', failures);
  const status = getRequiredEnum(document, 'status', TEMPLATE_STATUSES, failures);
  const config = getRequiredRecord(document, 'config', failures);
  const createdAt = getRequiredIsoTimestamp(document, 'createdAt', failures);
  const updatedAt = getRequiredIsoTimestamp(document, 'updatedAt', failures);

  if (failures.length > 0) {
    return invalid(failures);
  }

  return {
    valid: true,
    document: {
      templateId,
      version,
      name,
      schemaVersion,
      renderEngine,
      status,
      config,
      createdAt,
      updatedAt,
    },
  };
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

function invalid<T>(failures: ValidationFailure[]): ValidationResult<T> {
  return {
    valid: false,
    failures,
  };
}

function asRecord(
  value: unknown,
  failures: ValidationFailure[],
  field: string
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    failures.push({ field, message: 'expected object' });
    return undefined;
  }

  return value;
}

function getRequiredString(
  document: Record<string, unknown>,
  field: string,
  failures: ValidationFailure[]
): string {
  const value = document[field];
  if (typeof value !== 'string' || value.trim() === '') {
    failures.push({ field, message: 'expected non-empty string' });
    return '';
  }

  return value;
}

function getOptionalString(
  document: Record<string, unknown>,
  field: string,
  failures: ValidationFailure[]
): string | undefined {
  const value = document[field];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    failures.push({ field, message: 'expected non-empty string when present' });
    return undefined;
  }

  return value;
}

function getRequiredEnum<const T extends readonly string[]>(
  document: Record<string, unknown>,
  field: string,
  allowed: T,
  failures: ValidationFailure[]
): T[number] {
  const value = document[field];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    failures.push({ field, message: `expected one of: ${allowed.join(', ')}` });
    return allowed[0];
  }

  return value;
}

function getOptionalEnum<const T extends readonly string[]>(
  document: Record<string, unknown>,
  field: string,
  allowed: T,
  failures: ValidationFailure[]
): T[number] | undefined {
  const value = document[field];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !allowed.includes(value)) {
    failures.push({ field, message: `expected one of: ${allowed.join(', ')}` });
    return undefined;
  }

  return value;
}

function getRequiredRecord(
  document: Record<string, unknown>,
  field: string,
  failures: ValidationFailure[]
): Record<string, unknown> {
  const value = document[field];
  if (!isRecord(value)) {
    failures.push({ field, message: 'expected object' });
    return {};
  }

  return value;
}

function getOptionalRecord(
  document: Record<string, unknown>,
  field: string,
  failures: ValidationFailure[]
): Record<string, unknown> | undefined {
  const value = document[field];
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    failures.push({ field, message: 'expected object when present' });
    return undefined;
  }

  return value;
}

function getRequiredIsoTimestamp(
  document: Record<string, unknown>,
  field: string,
  failures: ValidationFailure[]
): string {
  const value = getRequiredString(document, field, failures);
  if (value !== '' && Number.isNaN(Date.parse(value))) {
    failures.push({ field, message: 'expected ISO-8601 timestamp' });
    return '';
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
