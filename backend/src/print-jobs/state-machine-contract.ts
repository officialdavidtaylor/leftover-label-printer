import { createMachine } from 'xstate';

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

type TransitionMachineEvent = {
  type: 'TO_PENDING' | 'TO_PROCESSING' | 'TO_DISPATCHED' | 'TO_PRINTED' | 'TO_FAILED';
  source: TransitionSource;
};

const TERMINAL_STATES = new Set<PrintJobState>(['printed', 'failed']);

const printJobStateMachine = createMachine<Record<string, never>, TransitionMachineEvent>(
  {
    id: 'printJobLifecycle',
    initial: 'pending',
    context: {},
    predictableActionArguments: true,
    states: {
      pending: {
        on: {
          TO_PROCESSING: { target: 'processing', cond: 'isBackendSource' },
        },
      },
      processing: {
        on: {
          TO_DISPATCHED: { target: 'dispatched', cond: 'isBackendSource' },
          TO_FAILED: { target: 'failed', cond: 'isBackendSource' },
        },
      },
      dispatched: {
        on: {
          TO_PRINTED: { target: 'printed', cond: 'isAgentSource' },
          TO_FAILED: { target: 'failed', cond: 'isAgentSource' },
        },
      },
      printed: {},
      failed: {},
    },
  },
  {
    guards: {
      isBackendSource: (_context, event) => event.source === 'backend',
      isAgentSource: (_context, event) => event.source === 'agent',
    },
  }
);

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
  const eventType = toMachineEventType(to);

  return (
    transitionState(from, { type: eventType, source: 'backend' }) !== from ||
    transitionState(from, { type: eventType, source: 'agent' }) !== from
  );
}

export function sourceCanApplyTransition(
  from: PrintJobState,
  to: PrintJobState,
  source: TransitionSource
): boolean {
  const eventType = toMachineEventType(to);
  return transitionState(from, { type: eventType, source }) !== from;
}

function transitionState(from: PrintJobState, event: TransitionMachineEvent): PrintJobState {
  const nextValue = printJobStateMachine.transition(from, event).value;

  if (typeof nextValue !== 'string') {
    throw new Error('unexpected non-atomic state value in printJobStateMachine');
  }

  return nextValue as PrintJobState;
}

function toMachineEventType(to: PrintJobState): TransitionMachineEvent['type'] {
  switch (to) {
    case 'pending':
      return 'TO_PENDING';
    case 'processing':
      return 'TO_PROCESSING';
    case 'dispatched':
      return 'TO_DISPATCHED';
    case 'printed':
      return 'TO_PRINTED';
    case 'failed':
      return 'TO_FAILED';
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
