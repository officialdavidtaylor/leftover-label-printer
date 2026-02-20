import { randomUUID } from 'node:crypto';

import { authorizePrintJobOperation, buildForbiddenError } from '../auth/rbac-policy.ts';
import { buildUnauthorizedError, type VerifiedJwtContext } from '../auth/jwt-verifier.ts';
import type { PrintJobState, PrintJobStatusResponse } from '../data/schema-contracts.ts';
import { orderPrintJobEvents } from '../print-jobs/order-events.ts';

type ErrorResponse = {
  code: string;
  message: string;
  traceId?: string;
};

export type GetPrintJobStatusHttpRequest = {
  authorizationHeader?: string;
  traceId?: string;
  jobId: string;
};

export type GetPrintJobStatusHttpResponse =
  | { status: 200; body: PrintJobStatusResponse }
  | { status: 401; body: ErrorResponse }
  | { status: 403; body: ErrorResponse }
  | { status: 404; body: ErrorResponse };

export type PersistedPrintJobForStatus = {
  jobId: string;
  ownerUserId: string;
  state: PrintJobState;
  printerId: string;
  templateId: string;
  templateVersion?: string;
};

export interface GetPrintJobStatusStore {
  findByJobId(jobId: string): Promise<PersistedPrintJobForStatus | null>;
  listEventsForJob(jobId: string): Promise<PrintJobStatusResponse['events']>;
}

export type GetPrintJobStatusAuthVerifier = {
  verifyAccessToken(token: string): Promise<VerifiedJwtContext>;
};

export type StatusReadLog = {
  event: 'print_job_status_read';
  traceId: string;
  jobId: string;
  role?: string;
  result: 'ok' | 'not_found' | 'forbidden' | 'unauthorized';
};

export type GetPrintJobStatusDependencies = {
  authVerifier: GetPrintJobStatusAuthVerifier;
  store: GetPrintJobStatusStore;
  createTraceId?: () => string;
  onLog?: (entry: StatusReadLog) => void;
};

export async function handleGetPrintJobStatus(
  request: GetPrintJobStatusHttpRequest,
  deps: GetPrintJobStatusDependencies
): Promise<GetPrintJobStatusHttpResponse> {
  const traceId = request.traceId ?? deps.createTraceId?.() ?? randomUUID();
  const token = extractBearerToken(request.authorizationHeader);
  // Missing or malformed bearer auth is always a 401 before any data lookup.
  if (!token) {
    deps.onLog?.({
      event: 'print_job_status_read',
      traceId,
      jobId: request.jobId,
      result: 'unauthorized',
    });
    return {
      status: 401,
      body: buildUnauthorizedError(traceId),
    };
  }

  let principal: VerifiedJwtContext;
  try {
    principal = await deps.authVerifier.verifyAccessToken(token);
  } catch {
    deps.onLog?.({
      event: 'print_job_status_read',
      traceId,
      jobId: request.jobId,
      result: 'unauthorized',
    });
    return {
      status: 401,
      body: buildUnauthorizedError(traceId),
    };
  }

  const job = await deps.store.findByJobId(request.jobId);
  if (!job) {
    deps.onLog?.({
      event: 'print_job_status_read',
      traceId,
      jobId: request.jobId,
      result: 'not_found',
      role: principal.roles[0],
    });
    return {
      status: 404,
      body: buildNotFoundError(traceId),
    };
  }

  const authorizationDecision = authorizePrintJobOperation({
    operation: 'getPrintJob',
    subjectUserId: principal.subject,
    subjectRoles: principal.roles,
    resourceOwnerUserId: job.ownerUserId,
  });
  if (!authorizationDecision.allowed) {
    deps.onLog?.({
      event: 'print_job_status_read',
      traceId,
      jobId: request.jobId,
      result: 'forbidden',
      role: principal.roles[0],
    });
    return {
      status: 403,
      body: buildForbiddenError(traceId),
    };
  }

  const events = await deps.store.listEventsForJob(job.jobId);
  // Timeline ordering is stable for clients: occurredAt ASC, then eventId ASC.
  const orderedEvents = orderPrintJobEvents(events);

  deps.onLog?.({
    event: 'print_job_status_read',
    traceId,
    jobId: request.jobId,
    result: 'ok',
    role: principal.roles[0],
  });

  return {
    status: 200,
    body: {
      jobId: job.jobId,
      state: job.state,
      printerId: job.printerId,
      templateId: job.templateId,
      ...(job.templateVersion ? { templateVersion: job.templateVersion } : {}),
      events: orderedEvents,
    },
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

function buildNotFoundError(traceId?: string): ErrorResponse {
  return {
    code: 'not_found',
    message: 'Print job not found',
    ...(traceId ? { traceId } : {}),
  };
}
