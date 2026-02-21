import { describe, expect, it } from 'vitest';

import {
  buildPrinterJobsTopic,
  publishPrintJobCommand,
  type PrintJobCommandPayload,
} from '../../backend/src/print-jobs/print-job-command-publisher.ts';

describe('print-job-command-publisher', () => {
  it('publishes print commands to printers/{printerId}/jobs with QoS 1', async () => {
    const published: Array<{
      topic: string;
      qos: 1;
      payload: PrintJobCommandPayload;
    }> = [];

    const result = await publishPrintJobCommand(
      {
        jobId: 'job-123',
        printerId: 'printer-1',
        traceId: 'trace-123',
        objectUrl: 'https://objects.example.com/signed/job-123?sig=abc',
      },
      {
        publisher: {
          async publish(input) {
            published.push(input);
          },
        },
        now: () => new Date('2026-02-20T20:00:00.000Z'),
        createEventId: () => 'event-123',
      }
    );

    expect(result).toEqual({
      topic: 'printers/printer-1/jobs',
      qos: 1,
      payload: {
        schemaVersion: '1.0.0',
        type: 'print_job_dispatch',
        eventId: 'event-123',
        traceId: 'trace-123',
        jobId: 'job-123',
        printerId: 'printer-1',
        objectUrl: 'https://objects.example.com/signed/job-123?sig=abc',
        issuedAt: '2026-02-20T20:00:00.000Z',
      },
    });
    expect(published).toEqual([result]);
  });

  it('accepts explicit issuedAt and schemaVersion values', async () => {
    let publishedPayload: PrintJobCommandPayload | null = null;

    await publishPrintJobCommand(
      {
        jobId: 'job-234',
        printerId: 'printer-2',
        traceId: 'trace-234',
        objectUrl: 'https://objects.example.com/signed/job-234?sig=abc',
        issuedAt: '2026-02-20T20:10:00.000Z',
      },
      {
        publisher: {
          async publish(input) {
            publishedPayload = input.payload;
          },
        },
        schemaVersion: '1.1.0',
        createEventId: () => 'event-234',
      }
    );

    expect(publishedPayload).toMatchObject({
      schemaVersion: '1.1.0',
      issuedAt: '2026-02-20T20:10:00.000Z',
    });
  });

  it('builds deterministic printer jobs topic paths', () => {
    expect(buildPrinterJobsTopic('printer-1')).toBe('printers/printer-1/jobs');
    expect(() => buildPrinterJobsTopic('   ')).toThrow('Too small');
  });
});
