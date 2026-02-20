export const PRINT_JOB_STATES = [
  'pending',
  'processing',
  'dispatched',
  'printed',
  'failed',
] as const;

export type PrintJobState = (typeof PRINT_JOB_STATES)[number];

export type PrintJobRecord = {
  jobId: string;
  idempotencyKey: string;
  printerId: string;
  templateId: string;
  templateVersion?: string;
  state: PrintJobState;
  acceptedAt: string;
  traceId: string;
};

export type CreatePrintJobInput = {
  idempotencyKey: string;
  printerId: string;
  templateId: string;
  templateVersion?: string;
  traceId: string;
  acceptedAt: string;
};

export type PrintJobAcceptedResponse = {
  jobId: string;
  state: PrintJobState;
  acceptedAt: string;
  traceId: string;
};

export type IdempotentSubmissionResult = {
  job: PrintJobRecord;
  response: PrintJobAcceptedResponse;
  duplicate: boolean;
};

export interface PrintJobStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<PrintJobRecord | null>;
  insert(job: PrintJobRecord): Promise<void>;
}

export class DuplicateIdempotencyKeyError extends Error {
  constructor(readonly idempotencyKey: string) {
    super('duplicate idempotency key');
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

export async function submitPrintJobIdempotently(
  request: CreatePrintJobInput,
  deps: {
    store: PrintJobStore;
    createJobId?: () => string;
    onDuplicate?: (details: { idempotencyKey: string; traceId: string; jobId: string }) => void;
  }
): Promise<IdempotentSubmissionResult> {
  const existing = await deps.store.findByIdempotencyKey(request.idempotencyKey);
  if (existing) {
    deps.onDuplicate?.({
      idempotencyKey: request.idempotencyKey,
      traceId: request.traceId,
      jobId: existing.jobId,
    });

    return {
      job: existing,
      response: toAcceptedResponse(existing),
      duplicate: true,
    };
  }

  const job: PrintJobRecord = {
    jobId: deps.createJobId ? deps.createJobId() : createDefaultJobId(),
    idempotencyKey: request.idempotencyKey,
    printerId: request.printerId,
    templateId: request.templateId,
    ...(request.templateVersion ? { templateVersion: request.templateVersion } : {}),
    state: 'pending',
    acceptedAt: request.acceptedAt,
    traceId: request.traceId,
  };

  try {
    await deps.store.insert(job);
  } catch (error) {
    if (error instanceof DuplicateIdempotencyKeyError) {
      const duplicated = await deps.store.findByIdempotencyKey(request.idempotencyKey);
      if (duplicated) {
        deps.onDuplicate?.({
          idempotencyKey: request.idempotencyKey,
          traceId: request.traceId,
          jobId: duplicated.jobId,
        });

        return {
          job: duplicated,
          response: toAcceptedResponse(duplicated),
          duplicate: true,
        };
      }
    }

    throw error;
  }

  return {
    job,
    response: toAcceptedResponse(job),
    duplicate: false,
  };
}

export function toAcceptedResponse(job: PrintJobRecord): PrintJobAcceptedResponse {
  return {
    jobId: job.jobId,
    state: job.state,
    acceptedAt: job.acceptedAt,
    traceId: job.traceId,
  };
}

function createDefaultJobId(): string {
  return `job-${Math.random().toString(16).slice(2, 10)}`;
}
