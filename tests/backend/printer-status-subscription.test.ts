import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import type { JobEventDocument } from '../../backend/src/data/schema-contracts.ts';
import {
  handlePrinterStatusMessage,
  PRINTER_STATUS_TOPIC_FILTER,
  subscribeToPrinterStatusEvents,
  type PrinterStatusSubscriberClient,
} from '../../backend/src/print-jobs/printer-status-subscription.ts';
import type { PrinterStatusStore } from '../../backend/src/print-jobs/printer-status-consumer.ts';

describe('printer-status-subscription', () => {
  it('subscribes to the canonical printer status topic filter with qos 1', async () => {
    const client = new FakeSubscriberClient();
    const store = new InMemoryPrinterStatusStore([], []);

    await subscribeToPrinterStatusEvents({
      client,
      store,
    });

    expect(client.subscribeCalls).toEqual([
      {
        topicFilter: PRINTER_STATUS_TOPIC_FILTER,
        qos: 1,
      },
    ]);
  });

  it('consumes valid JSON status messages from the subscribed topic', async () => {
    const client = new FakeSubscriberClient();
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

    await subscribeToPrinterStatusEvents({
      client,
      store,
    });

    await client.emitMessage(
      'printers/printer-1/status',
      Buffer.from(
        JSON.stringify({
          schemaVersion: '1.0.0',
          type: 'printed',
          eventId: 'event-printed',
          traceId: 'trace-123',
          jobId: 'job-123',
          printerId: 'printer-1',
          outcome: 'printed',
          occurredAt: '2026-03-12T11:00:00.000Z',
        })
      )
    );

    expect(store.jobs.get('job-123')?.state).toBe('printed');
    expect(store.events.get('job-123')).toHaveLength(1);
  });

  it('rejects malformed JSON payloads before they reach the state machine consumer', async () => {
    const store = new InMemoryPrinterStatusStore([], []);
    const logs: Array<{ event: string; result: string; message?: string }> = [];

    const result = await handlePrinterStatusMessage(
      {
        topic: 'printers/printer-1/status',
        payload: Buffer.from('{not-json'),
      },
      {
        store,
        onLog: (entry) => {
          if (entry.event === 'printer_status_subscription') {
            logs.push({
              event: entry.event,
              result: entry.result,
              message: entry.message,
            });
          }
        },
      }
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'payload_invalid',
      message: 'printer status payload must be valid JSON',
    });
    expect(logs).toEqual([
      {
        event: 'printer_status_subscription',
        result: 'payload_invalid',
        message: 'printer status payload must be valid JSON',
      },
    ]);
  });
});

class FakeSubscriberClient implements PrinterStatusSubscriberClient {
  readonly subscribeCalls: Array<{ topicFilter: string; qos: 1 }> = [];
  private readonly listeners: Array<(topic: string, payload: Buffer | Uint8Array) => void> = [];

  subscribe(topicFilter: string, options: { qos: 1 }, callback: (error?: Error | null) => void): void {
    this.subscribeCalls.push({
      topicFilter,
      qos: options.qos,
    });
    callback(null);
  }

  on(event: 'message', listener: (topic: string, payload: Buffer | Uint8Array) => void): void {
    if (event === 'message') {
      this.listeners.push(listener);
    }
  }

  async emitMessage(topic: string, payload: Buffer | Uint8Array): Promise<void> {
    for (const listener of this.listeners) {
      listener(topic, payload);
    }
    await Promise.resolve();
  }
}

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
