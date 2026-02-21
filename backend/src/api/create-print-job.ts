import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { authorizePrintJobOperation, buildForbiddenError } from '../auth/rbac-policy.ts';
import { buildUnauthorizedError, type VerifiedJwtContext } from '../auth/jwt-verifier.ts';
import type {
  JobEventDocument,
  PrintJobAcceptedResponse,
  PrintJobState,
  RenderedPdfMetadataDocument,
} from '../data/schema-contracts.ts';
import { DuplicateIdempotencyKeyError } from '../print-jobs/idempotent-submission.ts';
import { publishPrintJobCommand } from '../print-jobs/print-job-command-publisher.ts';

const createPrintJobRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  printerId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  templateVersion: z.string().trim().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

type CreatePrintJobRequestBody = z.infer<typeof createPrintJobRequestSchema>;

type ErrorResponse = {
  code: string;
  message: string;
  traceId?: string;
};

export type CreatePrintJobHttpRequest = {
  authorizationHeader?: string;
  traceId?: string;
  body: unknown;
};

export type CreatePrintJobHttpResponse =
  | { status: 202; body: PrintJobAcceptedResponse }
  | { status: 400; body: ErrorResponse }
  | { status: 401; body: ErrorResponse }
  | { status: 403; body: ErrorResponse };

export type PersistedPrintJob = {
  jobId: string;
  ownerUserId: string;
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
  renderedPdf?: RenderedPdfMetadataDocument;
};

export interface CreatePrintJobStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<PersistedPrintJob | null>;
  insertAccepted(data: { job: PersistedPrintJob; event: JobEventDocument }): Promise<void>;
  printerExists(printerId: string): Promise<boolean>;
  templateExists(templateId: string, templateVersion?: string): Promise<boolean>;
}

export type CreatePrintJobAuthVerifier = {
  verifyAccessToken(token: string): Promise<VerifiedJwtContext>;
};

export type SubmissionLog = {
  event: 'print_job_submission';
  result: 'accepted' | 'replayed' | 'validation_failed' | 'forbidden' | 'unauthorized';
  traceId: string;
  jobId?: string;
  printerId?: string;
};

export type RenderPdfForPrintJobInput = {
  templateId: string;
  templateVersion: string;
  payload: Record<string, unknown>;
};

export type RenderPdfForPrintJobResult = {
  contentType: string;
  pdfBytes: Uint8Array;
};

export type UploadRenderedPdfForPrintJobInput = {
  jobId: string;
  printerId: string;
  templateId: string;
  templateVersion: string;
  bucket: string;
  pdf: Uint8Array;
  contentType: string;
};

export type CreateRenderedPdfDownloadUrlForPrintJobInput = {
  jobId: string;
  renderedPdf: Pick<RenderedPdfMetadataDocument, 'bucket' | 'key'>;
};

export type CreateRenderedPdfDownloadUrlForPrintJobResult = {
  url: string;
  expiresAt: string;
  ttlSeconds: number;
};

export interface DispatchPrintJobCommandPublisher {
  publish(input: {
    topic: string;
    qos: 1;
    payload: {
      schemaVersion: string;
      type: 'print_job_dispatch';
      eventId: string;
      traceId: string;
      jobId: string;
      printerId: string;
      objectUrl: string;
      issuedAt: string;
    };
  }): Promise<void>;
}

export type CreatePrintJobDependencies = {
  authVerifier: CreatePrintJobAuthVerifier;
  store: CreatePrintJobStore;
  renderedPdfBucket: string;
  renderPdf: (input: RenderPdfForPrintJobInput) => Promise<RenderPdfForPrintJobResult>;
  uploadRenderedPdf: (input: UploadRenderedPdfForPrintJobInput) => Promise<RenderedPdfMetadataDocument>;
  createRenderedPdfDownloadUrl: (
    input: CreateRenderedPdfDownloadUrlForPrintJobInput
  ) => Promise<CreateRenderedPdfDownloadUrlForPrintJobResult>;
  commandPublisher: DispatchPrintJobCommandPublisher;
  now?: () => Date;
  createJobId?: () => string;
  createEventId?: () => string;
  createCommandEventId?: () => string;
  defaultTemplateVersion?: string;
  createTraceId?: () => string;
  onLog?: (entry: SubmissionLog) => void;
};

export async function handleCreatePrintJob(
  request: CreatePrintJobHttpRequest,
  deps: CreatePrintJobDependencies
): Promise<CreatePrintJobHttpResponse> {
  const traceId = request.traceId ?? deps.createTraceId?.() ?? randomUUID();
  const token = extractBearerToken(request.authorizationHeader);
  // Missing or malformed bearer auth is handled uniformly as 401.
  if (!token) {
    deps.onLog?.({ event: 'print_job_submission', result: 'unauthorized', traceId });
    return {
      status: 401,
      body: buildUnauthorizedError(traceId),
    };
  }

  let principal: VerifiedJwtContext;
  try {
    principal = await deps.authVerifier.verifyAccessToken(token);
  } catch {
    deps.onLog?.({ event: 'print_job_submission', result: 'unauthorized', traceId });
    return {
      status: 401,
      body: buildUnauthorizedError(traceId),
    };
  }

  const authorizationDecision = authorizePrintJobOperation({
    operation: 'createPrintJob',
    subjectUserId: principal.subject,
    subjectRoles: principal.roles,
  });
  if (!authorizationDecision.allowed) {
    deps.onLog?.({ event: 'print_job_submission', result: 'forbidden', traceId });
    return {
      status: 403,
      body: buildForbiddenError(traceId),
    };
  }

  const bodyResult = createPrintJobRequestSchema.safeParse(request.body);
  if (!bodyResult.success) {
    deps.onLog?.({ event: 'print_job_submission', result: 'validation_failed', traceId });
    return {
      status: 400,
      body: buildValidationError(traceId),
    };
  }

  const payload = bodyResult.data;
  const templateVersion = payload.templateVersion ?? deps.defaultTemplateVersion ?? 'v1';
  // Validate referenced resources before accepting the submission into job history.
  const [printerFound, templateFound] = await Promise.all([
    deps.store.printerExists(payload.printerId),
    deps.store.templateExists(payload.templateId, templateVersion),
  ]);

  if (!printerFound || !templateFound) {
    deps.onLog?.({
      event: 'print_job_submission',
      result: 'validation_failed',
      traceId,
      printerId: payload.printerId,
    });
    return {
      status: 400,
      body: buildValidationError(traceId),
    };
  }

  const existing = await deps.store.findByIdempotencyKey(payload.idempotencyKey);
  // Replay the original accepted job for idempotent retries.
  if (existing) {
    deps.onLog?.({
      event: 'print_job_submission',
      result: 'replayed',
      traceId,
      jobId: existing.jobId,
      printerId: existing.printerId,
    });

    return {
      status: 202,
      body: toAcceptedResponse(existing),
    };
  }

  const acceptedAt = (deps.now?.() ?? new Date()).toISOString();
  const job = createPrintJob(payload, {
    ownerUserId: principal.subject,
    traceId,
    acceptedAt,
    createJobId: deps.createJobId,
  });
  const initialEvent = createInitialEvent(job, {
    createEventId: deps.createEventId,
  });

  try {
    await deps.store.insertAccepted({
      job,
      event: initialEvent,
    });
  } catch (error) {
    // Unique-index races should still replay the persisted accepted job, not fail the caller.
    if (error instanceof DuplicateIdempotencyKeyError) {
      const duplicated = await deps.store.findByIdempotencyKey(payload.idempotencyKey);
      if (duplicated) {
        deps.onLog?.({
          event: 'print_job_submission',
          result: 'replayed',
          traceId,
          jobId: duplicated.jobId,
          printerId: duplicated.printerId,
        });
        return {
          status: 202,
          body: toAcceptedResponse(duplicated),
        };
      }
    }

    throw error;
  }

  await dispatchAcceptedPrintJob(
    {
      job,
      templateVersion,
      acceptedAt,
    },
    deps
  );

  deps.onLog?.({
    event: 'print_job_submission',
    result: 'accepted',
    traceId,
    jobId: job.jobId,
    printerId: job.printerId,
  });

  return {
    status: 202,
    body: toAcceptedResponse(job),
  };
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

function createPrintJob(
  payload: CreatePrintJobRequestBody,
  context: {
    ownerUserId: string;
    traceId: string;
    acceptedAt: string;
    createJobId?: () => string;
  }
): PersistedPrintJob {
  return {
    jobId: context.createJobId?.() ?? `job-${randomUUID()}`,
    ownerUserId: context.ownerUserId,
    idempotencyKey: payload.idempotencyKey,
    state: 'pending',
    printerId: payload.printerId,
    templateId: payload.templateId,
    ...(payload.templateVersion ? { templateVersion: payload.templateVersion } : {}),
    payload: payload.payload,
    traceId: context.traceId,
    acceptedAt: context.acceptedAt,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  };
}

function createInitialEvent(
  job: PersistedPrintJob,
  context: {
    createEventId?: () => string;
  }
): JobEventDocument {
  return {
    eventId: context.createEventId?.() ?? `event-${randomUUID()}`,
    jobId: job.jobId,
    type: 'pending',
    source: 'backend',
    occurredAt: job.acceptedAt,
    traceId: job.traceId,
  };
}

function toAcceptedResponse(job: PersistedPrintJob): PrintJobAcceptedResponse {
  return {
    jobId: job.jobId,
    state: job.state,
    acceptedAt: job.acceptedAt,
    traceId: job.traceId,
  };
}

async function dispatchAcceptedPrintJob(
  input: {
    job: PersistedPrintJob;
    templateVersion: string;
    acceptedAt: string;
  },
  deps: CreatePrintJobDependencies
): Promise<void> {
  const rendered = await deps.renderPdf({
    templateId: input.job.templateId,
    templateVersion: input.templateVersion,
    payload: input.job.payload,
  });

  const renderedPdf = await deps.uploadRenderedPdf({
    jobId: input.job.jobId,
    printerId: input.job.printerId,
    templateId: input.job.templateId,
    templateVersion: input.templateVersion,
    bucket: deps.renderedPdfBucket,
    pdf: rendered.pdfBytes,
    contentType: rendered.contentType,
  });

  const downloadUrl = await deps.createRenderedPdfDownloadUrl({
    jobId: input.job.jobId,
    renderedPdf: {
      bucket: renderedPdf.bucket,
      key: renderedPdf.key,
    },
  });

  await publishPrintJobCommand(
    {
      jobId: input.job.jobId,
      printerId: input.job.printerId,
      traceId: input.job.traceId,
      objectUrl: downloadUrl.url,
      issuedAt: input.acceptedAt,
    },
    {
      publisher: deps.commandPublisher,
      createEventId: deps.createCommandEventId,
      now: deps.now,
    }
  );
}

function buildValidationError(traceId?: string): ErrorResponse {
  return {
    code: 'validation_error',
    message: 'Validation error',
    ...(traceId ? { traceId } : {}),
  };
}
