import { z } from 'zod';

import { jobEventDocumentSchema, type JobEventDocument, type PrintJobState } from '../data/schema-contracts.ts';
import { applyPrintJobTransition, type TransitionRejectReason } from './state-machine-contract.ts';

const schemaVersionSchema = z.string().trim().regex(/^1\.[0-9]+\.[0-9]+$/);
const terminalOutcomeSchema = z.enum(['printed', 'failed']);
const isoTimestampSchema = z.string().trim().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'occurredAt must be an ISO-8601 timestamp',
});

const baseStatusPayloadSchema = z.object({
  schemaVersion: schemaVersionSchema,
  eventId: z.string().trim().min(1),
  traceId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  printerId: z.string().trim().min(1),
  occurredAt: isoTimestampSchema,
});

const heartbeatPayloadSchema = baseStatusPayloadSchema.extend({
  type: z.literal('heartbeat'),
  uptimeSeconds: z.number().int().min(0).optional(),
});

const legacyOutcomePayloadSchema = baseStatusPayloadSchema
  .extend({
    type: z.literal('job_outcome'),
    outcome: terminalOutcomeSchema,
    errorCode: z.string().trim().min(1).optional(),
    errorMessage: z.string().trim().min(1).optional(),
  })
  .superRefine((payload, ctx) => validateFailureDetails(payload.outcome, payload.errorCode, payload.errorMessage, ctx));

const definitiveOutcomePayloadSchema = baseStatusPayloadSchema
  .extend({
    type: terminalOutcomeSchema,
    outcome: terminalOutcomeSchema,
    errorCode: z.string().trim().min(1).optional(),
    errorMessage: z.string().trim().min(1).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.type !== payload.outcome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'outcome must match type for definitive terminal events',
      });
    }

    validateFailureDetails(payload.outcome, payload.errorCode, payload.errorMessage, ctx);
  });

const printerStatusTopicSchema = z.string().trim().regex(/^printers\/[^/]+\/status$/);

type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
type LegacyOutcomePayload = z.infer<typeof legacyOutcomePayloadSchema>;
type DefinitiveOutcomePayload = z.infer<typeof definitiveOutcomePayloadSchema>;

type ParsedTerminalOutcomePayload = {
  eventId: string;
  traceId: string;
  jobId: string;
  printerId: string;
  occurredAt: string;
  outcome: 'printed' | 'failed';
  errorCode?: string;
  errorMessage?: string;
};

export interface PrinterStatusStore {
  findByJobId(jobId: string): Promise<{
    jobId: string;
    state: PrintJobState;
    printerId: string;
  } | null>;
  listEventsForJob(jobId: string): Promise<JobEventDocument[]>;
  appendEventAndSetState(data: {
    jobId: string;
    nextState: PrintJobState;
    event: JobEventDocument;
  }): Promise<void>;
}

export type PrinterStatusConsumeResult =
  | {
      status: 'accepted';
      nextState: Extract<PrintJobState, 'printed' | 'failed'>;
      event: JobEventDocument;
    }
  | {
      status: 'ignored';
      reason: 'heartbeat' | 'unknown_job';
    }
  | {
      status: 'rejected';
      reason: 'invalid_topic' | 'payload_invalid' | 'printer_mismatch' | TransitionRejectReason;
      message?: string;
    };

export type PrinterStatusLogRecord = {
  event: 'printer_status_consumed';
  result: PrinterStatusConsumeResult['status'];
  reason?: PrinterStatusConsumeResult extends { reason: infer T } ? T : never;
  jobId?: string;
  printerId?: string;
  traceId?: string;
  nextState?: Extract<PrintJobState, 'printed' | 'failed'>;
  message?: string;
};

export async function consumePrinterStatusEvent(
  input: {
    topic: string;
    payload: unknown;
  },
  deps: {
    store: PrinterStatusStore;
    onLog?: (entry: PrinterStatusLogRecord) => void;
  }
): Promise<PrinterStatusConsumeResult> {
  const topicPrinterId = parsePrinterStatusTopic(input.topic);
  if (!topicPrinterId) {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'rejected',
      reason: 'invalid_topic',
      message: `invalid printer status topic: ${input.topic}`,
    });
    return {
      status: 'rejected',
      reason: 'invalid_topic',
      message: `invalid printer status topic: ${input.topic}`,
    };
  }

  const parsedPayload = parsePrinterStatusPayload(input.payload);
  if (parsedPayload.status === 'rejected') {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'rejected',
      reason: 'payload_invalid',
      printerId: topicPrinterId,
      jobId: parsedPayload.jobId,
      traceId: parsedPayload.traceId,
      message: parsedPayload.message,
    });
    return parsedPayload;
  }

  if (parsedPayload.status === 'ignored') {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'ignored',
      reason: 'heartbeat',
      printerId: topicPrinterId,
    });
    return parsedPayload;
  }

  if (parsedPayload.payload.printerId !== topicPrinterId) {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'rejected',
      reason: 'printer_mismatch',
      printerId: topicPrinterId,
      jobId: parsedPayload.payload.jobId,
      traceId: parsedPayload.payload.traceId,
      message: 'payload printerId does not match status topic',
    });
    return {
      status: 'rejected',
      reason: 'printer_mismatch',
      message: 'payload printerId does not match status topic',
    };
  }

  const job = await deps.store.findByJobId(parsedPayload.payload.jobId);
  if (!job) {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'ignored',
      reason: 'unknown_job',
      printerId: parsedPayload.payload.printerId,
      jobId: parsedPayload.payload.jobId,
      traceId: parsedPayload.payload.traceId,
    });
    return {
      status: 'ignored',
      reason: 'unknown_job',
    };
  }

  if (job.printerId !== parsedPayload.payload.printerId) {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'rejected',
      reason: 'printer_mismatch',
      printerId: parsedPayload.payload.printerId,
      jobId: parsedPayload.payload.jobId,
      traceId: parsedPayload.payload.traceId,
      message: 'job printerId does not match status payload',
    });
    return {
      status: 'rejected',
      reason: 'printer_mismatch',
      message: 'job printerId does not match status payload',
    };
  }

  const existingEvents = await deps.store.listEventsForJob(job.jobId);
  const decision = applyPrintJobTransition({
    jobId: job.jobId,
    currentState: job.state,
    event: {
      eventId: parsedPayload.payload.eventId,
      traceId: parsedPayload.payload.traceId,
      source: 'agent',
      targetState: parsedPayload.payload.outcome,
      occurredAt: parsedPayload.payload.occurredAt,
    },
    processedEventIds: new Set(existingEvents.map((event) => event.eventId)),
  });

  if (!decision.accepted) {
    deps.onLog?.({
      event: 'printer_status_consumed',
      result: 'rejected',
      reason: decision.reason,
      printerId: parsedPayload.payload.printerId,
      jobId: parsedPayload.payload.jobId,
      traceId: parsedPayload.payload.traceId,
    });
    return {
      status: 'rejected',
      reason: decision.reason,
    };
  }

  const event = jobEventDocumentSchema.parse({
    eventId: parsedPayload.payload.eventId,
    jobId: parsedPayload.payload.jobId,
    type: parsedPayload.payload.outcome,
    source: 'agent',
    printerId: parsedPayload.payload.printerId,
    occurredAt: parsedPayload.payload.occurredAt,
    traceId: parsedPayload.payload.traceId,
    outcome: parsedPayload.payload.outcome,
    ...(parsedPayload.payload.errorCode ? { errorCode: parsedPayload.payload.errorCode } : {}),
    ...(parsedPayload.payload.errorMessage ? { errorMessage: parsedPayload.payload.errorMessage } : {}),
  });

  await deps.store.appendEventAndSetState({
    jobId: job.jobId,
    nextState: decision.nextState,
    event,
  });

  deps.onLog?.({
    event: 'printer_status_consumed',
    result: 'accepted',
    printerId: parsedPayload.payload.printerId,
    jobId: parsedPayload.payload.jobId,
    traceId: parsedPayload.payload.traceId,
    nextState: decision.nextState,
  });

  return {
    status: 'accepted',
    nextState: decision.nextState,
    event,
  };
}

export function parsePrinterStatusTopic(topic: string): string | null {
  const result = printerStatusTopicSchema.safeParse(topic);
  if (!result.success) {
    return null;
  }

  const segments = result.data.split('/');
  return segments[1] ?? null;
}

function parsePrinterStatusPayload(
  payload: unknown
):
  | { status: 'ignored'; reason: 'heartbeat' }
  | { status: 'accepted'; payload: ParsedTerminalOutcomePayload }
  | { status: 'rejected'; reason: 'payload_invalid'; message: string; jobId?: string; traceId?: string } {
  const heartbeatResult = heartbeatPayloadSchema.safeParse(payload);
  if (heartbeatResult.success) {
    return {
      status: 'ignored',
      reason: 'heartbeat',
    };
  }

  const definitiveResult = definitiveOutcomePayloadSchema.safeParse(payload);
  if (definitiveResult.success) {
    return {
      status: 'accepted',
      payload: normalizeDefinitiveOutcomePayload(definitiveResult.data),
    };
  }

  const legacyResult = legacyOutcomePayloadSchema.safeParse(payload);
  if (legacyResult.success) {
    return {
      status: 'accepted',
      payload: normalizeLegacyOutcomePayload(legacyResult.data),
    };
  }

  const message =
    definitiveResult.error?.issues[0]?.message ??
    legacyResult.error?.issues[0]?.message ??
    heartbeatResult.error?.issues[0]?.message ??
    'invalid printer status payload';

  return {
    status: 'rejected',
    reason: 'payload_invalid',
    message,
    jobId: getStringField(payload, 'jobId'),
    traceId: getStringField(payload, 'traceId'),
  };
}

function normalizeLegacyOutcomePayload(payload: LegacyOutcomePayload): ParsedTerminalOutcomePayload {
  return {
    eventId: payload.eventId,
    traceId: payload.traceId,
    jobId: payload.jobId,
    printerId: payload.printerId,
    occurredAt: payload.occurredAt,
    outcome: payload.outcome,
    ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
  };
}

function normalizeDefinitiveOutcomePayload(payload: DefinitiveOutcomePayload): ParsedTerminalOutcomePayload {
  return {
    eventId: payload.eventId,
    traceId: payload.traceId,
    jobId: payload.jobId,
    printerId: payload.printerId,
    occurredAt: payload.occurredAt,
    outcome: payload.outcome,
    ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
  };
}

function validateFailureDetails(
  outcome: 'printed' | 'failed',
  errorCode: string | undefined,
  errorMessage: string | undefined,
  ctx: z.RefinementCtx
): void {
  if (outcome !== 'failed') {
    return;
  }

  if (!errorCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['errorCode'],
      message: 'errorCode is required for failed outcomes',
    });
  }

  if (!errorMessage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['errorMessage'],
      message: 'errorMessage is required for failed outcomes',
    });
  }
}

function getStringField(value: unknown, fieldName: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[fieldName];
  return typeof field === 'string' && field.trim() !== '' ? field : undefined;
}
