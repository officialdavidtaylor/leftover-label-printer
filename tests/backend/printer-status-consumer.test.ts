import { describe, expect, it } from 'vitest';

import type { JobEventDocument } from '../../backend/src/data/schema-contracts.ts';
import {
  consumePrinterStatusEvent,
  parsePrinterStatusTopic,
  type PrinterStatusStore,
} from '../../backend/src/print-jobs/printer-status-consumer.ts';

describe('printer-status-consumer', () => {
  it('accepts definitive printed events for dispatched jobs', async () => {
    const store = new InMemoryPrinterStatusStore(
      [
        {
          jobId: 'job-123',
          state: 'dispatched',
          printerId: 'printer-1',
        },
      ],
      [
        {
          eventId: 'event-pending',
          jobId: 'job-123',
          type: 'pending',
          source: 'backend',
          occurredAt: '2026-03-12T10:00:00.000Z',
          traceId: 'trace-123',
        },
      ]
    );

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'printed',
          eventId: 'event-printed',
          traceId: 'trace-123',
          jobId: 'job-123',
          printerId: 'printer-1',
          outcome: 'printed',
          occurredAt: '2026-03-12T10:05:00.000Z',
        },
      },
      { store }
    );

    expect(result).toMatchObject({
      status: 'accepted',
      nextState: 'printed',
    });
    expect(store.jobs.get('job-123')?.state).toBe('printed');
    expect(store.events.get('job-123')?.map((event) => event.type)).toEqual(['pending', 'printed']);
  });

  it('accepts legacy job_outcome payloads while USE-36 is still converging', async () => {
    const store = new InMemoryPrinterStatusStore(
      [
        {
          jobId: 'job-legacy',
          state: 'dispatched',
          printerId: 'printer-2',
        },
      ],
      []
    );

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-2/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'job_outcome',
          eventId: 'event-failed',
          traceId: 'trace-legacy',
          jobId: 'job-legacy',
          printerId: 'printer-2',
          outcome: 'failed',
          occurredAt: '2026-03-12T10:06:00.000Z',
          errorCode: 'lp_failed',
          errorMessage: 'lp exited 1',
        },
      },
      { store }
    );

    expect(result).toMatchObject({
      status: 'accepted',
      nextState: 'failed',
    });
    expect(store.jobs.get('job-legacy')?.state).toBe('failed');
    expect(store.events.get('job-legacy')?.[0]).toMatchObject({
      type: 'failed',
      source: 'agent',
      errorCode: 'lp_failed',
      errorMessage: 'lp exited 1',
    });
  });

  it('ignores heartbeat events', async () => {
    const store = new InMemoryPrinterStatusStore([], []);

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'heartbeat',
          eventId: 'event-heartbeat',
          traceId: 'trace-heartbeat',
          printerId: 'printer-1',
          jobId: 'job-heartbeat',
          occurredAt: '2026-03-12T10:07:00.000Z',
          uptimeSeconds: 30,
        },
      },
      { store }
    );

    expect(result).toEqual({
      status: 'ignored',
      reason: 'heartbeat',
    });
  });

  it('ignores terminal events for unknown jobs', async () => {
    const store = new InMemoryPrinterStatusStore([], []);

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'printed',
          eventId: 'event-unknown',
          traceId: 'trace-unknown',
          jobId: 'job-unknown',
          printerId: 'printer-1',
          outcome: 'printed',
          occurredAt: '2026-03-12T10:08:00.000Z',
        },
      },
      { store }
    );

    expect(result).toEqual({
      status: 'ignored',
      reason: 'unknown_job',
    });
  });

  it('rejects payloads whose printer does not match the topic', async () => {
    const store = new InMemoryPrinterStatusStore(
      [
        {
          jobId: 'job-123',
          state: 'dispatched',
          printerId: 'printer-1',
        },
      ],
      []
    );

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'printed',
          eventId: 'event-mismatch',
          traceId: 'trace-mismatch',
          jobId: 'job-123',
          printerId: 'printer-2',
          outcome: 'printed',
          occurredAt: '2026-03-12T10:09:00.000Z',
        },
      },
      { store }
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'printer_mismatch',
    });
  });

  it('rejects payloads that violate the state machine', async () => {
    const store = new InMemoryPrinterStatusStore(
      [
        {
          jobId: 'job-pending',
          state: 'pending',
          printerId: 'printer-1',
        },
      ],
      []
    );

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'printed',
          eventId: 'event-too-early',
          traceId: 'trace-too-early',
          jobId: 'job-pending',
          printerId: 'printer-1',
          outcome: 'printed',
          occurredAt: '2026-03-12T10:10:00.000Z',
        },
      },
      { store }
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid_transition',
    });
  });

  it('rejects duplicate event ids deterministically', async () => {
    const store = new InMemoryPrinterStatusStore(
      [
        {
          jobId: 'job-dup',
          state: 'dispatched',
          printerId: 'printer-1',
        },
      ],
      [
        {
          eventId: 'event-dup',
          jobId: 'job-dup',
          type: 'dispatched',
          source: 'backend',
          occurredAt: '2026-03-12T10:00:00.000Z',
          traceId: 'trace-dup',
        },
      ]
    );

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'printed',
          eventId: 'event-dup',
          traceId: 'trace-dup',
          jobId: 'job-dup',
          printerId: 'printer-1',
          outcome: 'printed',
          occurredAt: '2026-03-12T10:11:00.000Z',
        },
      },
      { store }
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'duplicate_event',
    });
  });

  it('rejects failed outcomes without error details', async () => {
    const store = new InMemoryPrinterStatusStore(
      [
        {
          jobId: 'job-failed',
          state: 'dispatched',
          printerId: 'printer-1',
        },
      ],
      []
    );

    const result = await consumePrinterStatusEvent(
      {
        topic: 'printers/printer-1/status',
        payload: {
          schemaVersion: '1.0.0',
          type: 'failed',
          eventId: 'event-failed-missing-details',
          traceId: 'trace-failed',
          jobId: 'job-failed',
          printerId: 'printer-1',
          outcome: 'failed',
          occurredAt: '2026-03-12T10:12:00.000Z',
        },
      },
      { store }
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'payload_invalid',
      message: 'errorCode is required for failed outcomes',
    });
  });
});

describe('parsePrinterStatusTopic', () => {
  it('extracts printer ids from canonical status topics', () => {
    expect(parsePrinterStatusTopic('printers/printer-1/status')).toBe('printer-1');
  });

  it('rejects non-status topics', () => {
    expect(parsePrinterStatusTopic('printers/printer-1/jobs')).toBeNull();
  });
});

class InMemoryPrinterStatusStore implements PrinterStatusStore {
  readonly jobs = new Map<string, { jobId: string; state: JobEventDocument['type']; printerId: string }>();
  readonly events = new Map<string, JobEventDocument[]>();

  constructor(
    seedJobs: Array<{ jobId: string; state: JobEventDocument['type']; printerId: string }>,
    seedEvents: JobEventDocument[]
  ) {
    for (const job of seedJobs) {
      this.jobs.set(job.jobId, job);
    }

    for (const event of seedEvents) {
      const existing = this.events.get(event.jobId) ?? [];
      existing.push(event);
      this.events.set(event.jobId, existing);
    }
  }

  async findByJobId(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }

  async listEventsForJob(jobId: string): Promise<JobEventDocument[]> {
    return [...(this.events.get(jobId) ?? [])];
  }

  async appendEventAndSetState(data: {
    jobId: string;
    nextState: JobEventDocument['type'];
    event: JobEventDocument;
  }): Promise<void> {
    const job = this.jobs.get(data.jobId);
    if (!job) {
      throw new Error(`job not found: ${data.jobId}`);
    }

    job.state = data.nextState;
    const existing = this.events.get(data.jobId) ?? [];
    existing.push(data.event);
    this.events.set(data.jobId, existing);
  }
}
