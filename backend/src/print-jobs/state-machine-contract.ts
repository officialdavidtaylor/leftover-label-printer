export const PRINT_JOB_STATES = [
  'pending',
  'processing',
  'dispatched',
  'printed',
  'failed',
] as const;

export type PrintJobState = (typeof PRINT_JOB_STATES)[number];

export type TransitionSource = 'backend' | 'agent';

export type TransitionEvent = {
  eventId: string;
  traceId: string;
  source: TransitionSource;
  targetState: PrintJobState;
  occurredAt: string;
};

export type TransitionKey = `${PrintJobState}->${PrintJobState}`;

export type TransitionRejectReason =
  | 'duplicate_event'
  | 'invalid_transition'
  | 'authority_violation'
  | 'terminal_state_locked';

export type TransitionAuditRecord = {
  event: 'job_transition_rejected';
  level: 'warn';
  jobId: string;
  eventId: string;
  traceId: string;
  source: TransitionSource;
  previousState: PrintJobState;
  targetState: PrintJobState;
  reason: TransitionRejectReason;
  occurredAt: string;
};

export type TransitionLogRecord = {
  event: 'job_transition_applied';
  level: 'info';
  jobId: string;
  eventId: string;
  traceId: string;
  source: TransitionSource;
  previousState: PrintJobState;
  targetState: PrintJobState;
  occurredAt: string;
};

export type TransitionDecision =
  | {
      accepted: true;
      nextState: PrintJobState;
      processedEventIds: Set<string>;
      log: TransitionLogRecord;
    }
  | {
      accepted: false;
      reason: TransitionRejectReason;
      nextState: PrintJobState;
      processedEventIds: Set<string>;
      audit: TransitionAuditRecord;
    };

const TERMINAL_STATES = new Set<PrintJobState>(['printed', 'failed']);
const MATRIX: ReadonlySet<TransitionKey> = new Set<TransitionKey>([
  'pending->processing',
  'processing->dispatched',
  'processing->failed',
  'dispatched->printed',
  'dispatched->failed',
]);

export function applyPrintJobTransition(input: {
  jobId: string;
  currentState: PrintJobState;
  event: TransitionEvent;
  processedEventIds?: ReadonlySet<string>;
}): TransitionDecision {
  const processedEventIds = new Set(input.processedEventIds ?? []);
  const { event } = input;

  if (processedEventIds.has(event.eventId)) {
    return {
      accepted: false,
      reason: 'duplicate_event',
      nextState: input.currentState,
      processedEventIds,
      audit: buildAuditRecord(input, 'duplicate_event'),
    };
  }

  if (TERMINAL_STATES.has(input.currentState)) {
    return {
      accepted: false,
      reason: 'terminal_state_locked',
      nextState: input.currentState,
      processedEventIds,
      audit: buildAuditRecord(input, 'terminal_state_locked'),
    };
  }

  if (!isTransitionAllowed(input.currentState, event.targetState)) {
    return {
      accepted: false,
      reason: 'invalid_transition',
      nextState: input.currentState,
      processedEventIds,
      audit: buildAuditRecord(input, 'invalid_transition'),
    };
  }

  if (!sourceCanApplyTransition(input.currentState, event.targetState, event.source)) {
    return {
      accepted: false,
      reason: 'authority_violation',
      nextState: input.currentState,
      processedEventIds,
      audit: buildAuditRecord(input, 'authority_violation'),
    };
  }

  processedEventIds.add(event.eventId);

  return {
    accepted: true,
    nextState: event.targetState,
    processedEventIds,
    log: {
      event: 'job_transition_applied',
      level: 'info',
      jobId: input.jobId,
      eventId: event.eventId,
      traceId: event.traceId,
      source: event.source,
      previousState: input.currentState,
      targetState: event.targetState,
      occurredAt: event.occurredAt,
    },
  };
}

export function isTransitionAllowed(from: PrintJobState, to: PrintJobState): boolean {
  return MATRIX.has(`${from}->${to}`);
}

export function sourceCanApplyTransition(
  from: PrintJobState,
  to: PrintJobState,
  source: TransitionSource
): boolean {
  const transition = `${from}->${to}`;

  switch (transition) {
    case 'pending->processing':
    case 'processing->dispatched':
    case 'processing->failed':
      return source === 'backend';
    case 'dispatched->printed':
    case 'dispatched->failed':
      return source === 'agent';
    default:
      return false;
  }
}

function buildAuditRecord(
  input: {
    jobId: string;
    currentState: PrintJobState;
    event: TransitionEvent;
  },
  reason: TransitionRejectReason
): TransitionAuditRecord {
  return {
    event: 'job_transition_rejected',
    level: 'warn',
    jobId: input.jobId,
    eventId: input.event.eventId,
    traceId: input.event.traceId,
    source: input.event.source,
    previousState: input.currentState,
    targetState: input.event.targetState,
    reason,
    occurredAt: input.event.occurredAt,
  };
}
