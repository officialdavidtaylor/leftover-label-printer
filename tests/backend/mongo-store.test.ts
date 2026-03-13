import { describe, expect, it, vi } from 'vitest';

import type { PersistedPrintJob } from '../../backend/src/api/create-print-job.ts';
import type { JobEventDocument } from '../../backend/src/data/schema-contracts.ts';
import { MongoBackendStore, type BackendCollections } from '../../backend/src/runtime/mongo-store.ts';

describe('mongo-backend-store lifecycle persistence', () => {
  it('wraps accepted job and initial event inserts in one transaction session', async () => {
    const session = createFakeSession();
    const printJobsInsertOne = vi.fn(async () => ({ acknowledged: true }));
    const jobEventsInsertOne = vi.fn(async () => ({ acknowledged: true }));
    const store = new MongoBackendStore(
      createCollections({
        session,
        printJobs: {
          insertOne: printJobsInsertOne,
        },
        jobEvents: {
          insertOne: jobEventsInsertOne,
        },
      })
    );

    await store.insertAccepted({
      job: createJob(),
      event: createPendingEvent(),
    });

    expect(session.withTransaction).toHaveBeenCalledOnce();
    expect(printJobsInsertOne).toHaveBeenCalledOnce();
    expect(jobEventsInsertOne).toHaveBeenCalledOnce();
    expect(printJobsInsertOne.mock.calls[0]?.[1]).toMatchObject({ session });
    expect(jobEventsInsertOne.mock.calls[0]?.[1]).toMatchObject({ session });
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('wraps lifecycle state updates and event inserts in one transaction session', async () => {
    const session = createFakeSession();
    const printJobsUpdateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const jobEventsInsertOne = vi.fn(async () => ({ acknowledged: true }));
    const store = new MongoBackendStore(
      createCollections({
        session,
        printJobs: {
          updateOne: printJobsUpdateOne,
        },
        jobEvents: {
          insertOne: jobEventsInsertOne,
        },
      })
    );

    await store.appendEventAndSetState({
      jobId: 'job-123',
      nextState: 'processing',
      event: createProcessingEvent(),
    });

    expect(session.withTransaction).toHaveBeenCalledOnce();
    expect(printJobsUpdateOne).toHaveBeenCalledOnce();
    expect(jobEventsInsertOne).toHaveBeenCalledOnce();
    expect(printJobsUpdateOne.mock.calls[0]?.[2]).toMatchObject({ session });
    expect(jobEventsInsertOne.mock.calls[0]?.[1]).toMatchObject({ session });
    expect(session.endSession).toHaveBeenCalledOnce();
  });
});

function createCollections(overrides: {
  session: ReturnType<typeof createFakeSession>;
  printJobs?: {
    insertOne?: ReturnType<typeof vi.fn>;
    updateOne?: ReturnType<typeof vi.fn>;
  };
  jobEvents?: {
    insertOne?: ReturnType<typeof vi.fn>;
  };
}): BackendCollections {
  const db = {
    client: {
      startSession: vi.fn(() => overrides.session),
    },
  };

  return {
    printJobs: {
      db,
      insertOne: overrides.printJobs?.insertOne ?? vi.fn(async () => ({ acknowledged: true })),
      updateOne: overrides.printJobs?.updateOne ?? vi.fn(async () => ({ matchedCount: 1 })),
    } as unknown as BackendCollections['printJobs'],
    jobEvents: {
      db,
      insertOne: overrides.jobEvents?.insertOne ?? vi.fn(async () => ({ acknowledged: true })),
    } as unknown as BackendCollections['jobEvents'],
    printers: {} as BackendCollections['printers'],
    templates: {} as BackendCollections['templates'],
  };
}

function createFakeSession() {
  return {
    withTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
    endSession: vi.fn(async () => undefined),
  };
}

function createJob(): PersistedPrintJob {
  return {
    jobId: 'job-123',
    ownerUserId: 'user-123',
    idempotencyKey: 'idem-123',
    state: 'pending',
    printerId: 'printer-1',
    templateId: 'template-1',
    payload: { itemName: 'Soup' },
    traceId: 'trace-123',
    acceptedAt: '2026-02-20T20:00:00.000Z',
    createdAt: '2026-02-20T20:00:00.000Z',
    updatedAt: '2026-02-20T20:00:00.000Z',
  };
}

function createPendingEvent(): JobEventDocument {
  return {
    eventId: 'event-pending',
    jobId: 'job-123',
    type: 'pending',
    source: 'backend',
    occurredAt: '2026-02-20T20:00:00.000Z',
    traceId: 'trace-123',
  };
}

function createProcessingEvent(): JobEventDocument {
  return {
    eventId: 'event-processing',
    jobId: 'job-123',
    type: 'processing',
    source: 'backend',
    occurredAt: '2026-02-20T20:01:00.000Z',
    traceId: 'trace-123',
  };
}
