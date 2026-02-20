import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyPrintJobTransition,
  isTransitionAllowed,
  sourceCanApplyTransition,
  type TransitionEvent,
} from '../../backend/src/print-jobs/state-machine-contract.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');
const asyncApiPath = path.resolve(fileDir, '../../contracts/asyncapi.yaml');

describe('state-machine-contract', () => {
  it('accepts every allowed transition in the matrix', () => {
    const accepted = [
      attempt('pending', event('evt-1', 'backend', 'processing')),
      attempt('processing', event('evt-2', 'backend', 'dispatched')),
      attempt('processing', event('evt-3', 'backend', 'failed')),
      attempt('dispatched', event('evt-4', 'agent', 'printed')),
      attempt('dispatched', event('evt-5', 'agent', 'failed')),
    ];

    for (const decision of accepted) {
      expect(decision.accepted).toBe(true);
      if (decision.accepted) {
        expect(decision.log.event).toBe('job_transition_applied');
      }
    }
  });

  it('rejects transitions not present in the matrix', () => {
    const decision = attempt('pending', event('evt-invalid', 'backend', 'printed'));

    expect(decision).toMatchObject({
      accepted: false,
      reason: 'invalid_transition',
      nextState: 'pending',
    });
    if (!decision.accepted) {
      expect(decision.audit.event).toBe('job_transition_rejected');
      expect(decision.audit.traceId).toBe('trace-1');
    }
  });

  it('rejects authority violations for valid transitions', () => {
    const decision = attempt('dispatched', event('evt-auth', 'backend', 'printed'));

    expect(decision).toMatchObject({
      accepted: false,
      reason: 'authority_violation',
      nextState: 'dispatched',
    });
  });

  it('rejects duplicate events by eventId', () => {
    const first = attempt('pending', event('evt-dup', 'backend', 'processing'), new Set());

    expect(first.accepted).toBe(true);
    if (!first.accepted) {
      throw new Error('expected first decision to be accepted');
    }

    const duplicate = attempt(
      'processing',
      event('evt-dup', 'backend', 'dispatched'),
      first.processedEventIds
    );

    expect(duplicate).toMatchObject({
      accepted: false,
      reason: 'duplicate_event',
      nextState: 'processing',
    });
  });

  it('rejects stale transitions from terminal states', () => {
    const decision = attempt('printed', event('evt-stale', 'agent', 'failed'));

    expect(decision).toMatchObject({
      accepted: false,
      reason: 'terminal_state_locked',
      nextState: 'printed',
    });
  });

  it('exposes helper predicates for matrix and source authority', () => {
    expect(isTransitionAllowed('pending', 'processing')).toBe(true);
    expect(isTransitionAllowed('pending', 'dispatched')).toBe(false);

    expect(sourceCanApplyTransition('processing', 'failed', 'backend')).toBe(true);
    expect(sourceCanApplyTransition('processing', 'failed', 'agent')).toBe(false);
    expect(sourceCanApplyTransition('dispatched', 'printed', 'agent')).toBe(true);
  });
});

describe('state-machine-contract-api-alignment', () => {
  it('keeps state and event outcome enums aligned with OpenAPI and AsyncAPI', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');
    const asyncApiText = fs.readFileSync(asyncApiPath, 'utf8');

    expect(openApiText).toContain('PrintJobState:');
    expect(openApiText).toContain('- pending');
    expect(openApiText).toContain('- processing');
    expect(openApiText).toContain('- dispatched');
    expect(openApiText).toContain('- printed');
    expect(openApiText).toContain('- failed');

    expect(asyncApiText).toContain('PrintJobOutcomePayload:');
    expect(asyncApiText).toContain('outcome:');
    expect(asyncApiText).toContain('- printed');
    expect(asyncApiText).toContain('- failed');
  });
});

function attempt(
  currentState: 'pending' | 'processing' | 'dispatched' | 'printed' | 'failed',
  transitionEvent: TransitionEvent,
  processedEventIds?: ReadonlySet<string>
) {
  return applyPrintJobTransition({
    jobId: 'job-1',
    currentState,
    event: transitionEvent,
    processedEventIds,
  });
}

function event(
  eventId: string,
  source: 'backend' | 'agent',
  targetState: 'pending' | 'processing' | 'dispatched' | 'printed' | 'failed'
): TransitionEvent {
  return {
    eventId,
    traceId: 'trace-1',
    source,
    targetState,
    occurredAt: '2026-02-20T16:30:00.000Z',
  };
}
