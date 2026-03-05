import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  publishPrintJobCommand,
  type PrintJobCommandPayload,
} from '../../backend/src/print-jobs/print-job-command-publisher.ts';
import {
  assertMatchesJsonSchema,
  getPublishPayloadSchema,
  loadAsyncApiContract,
  type AsyncApiContract,
} from './helpers/asyncapi-contract.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const asyncApiPath = path.resolve(fileDir, '../../contracts/asyncapi.yaml');

let contract: AsyncApiContract;

beforeAll(async () => {
  contract = await loadAsyncApiContract(asyncApiPath);
});

describe('publisher-asyncapi-contract', () => {
  it('keeps backend command publish channel and required metadata fields aligned to AsyncAPI', () => {
    expect(contract.channels['printers/{id}/jobs']).toBeDefined();

    const payloadSchema = getPublishPayloadSchema(contract, 'printers/{id}/jobs');
    expect(payloadSchema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'type',
        'eventId',
        'traceId',
        'jobId',
        'printerId',
        'objectUrl',
        'issuedAt',
      ])
    );
    expect(payloadSchema.additionalProperties).toBe(false);
  });

  it('validates a real backend command publish payload against AsyncAPI schema', async () => {
    let publishedPayload: PrintJobCommandPayload | null = null;

    await publishPrintJobCommand(
      {
        jobId: 'job-123',
        printerId: 'printer-1',
        traceId: 'trace-123',
        objectUrl: 'https://objects.example.com/signed/job-123?sig=abc',
      },
      {
        publisher: {
          async publish(input) {
            publishedPayload = input.payload;
          },
        },
        now: () => new Date('2026-02-20T20:00:00.000Z'),
        createEventId: () => 'event-123',
      }
    );

    expect(publishedPayload).not.toBeNull();

    const payloadSchema = getPublishPayloadSchema(contract, 'printers/{id}/jobs');
    assertMatchesJsonSchema({
      contract,
      schema: payloadSchema,
      value: publishedPayload,
      subject: 'PrintJobCommandPayload',
    });
  });

  it('fails contract validation when required command metadata is missing', async () => {
    let publishedPayload: PrintJobCommandPayload | null = null;

    await publishPrintJobCommand(
      {
        jobId: 'job-789',
        printerId: 'printer-1',
        traceId: 'trace-789',
        objectUrl: 'https://objects.example.com/signed/job-789?sig=abc',
      },
      {
        publisher: {
          async publish(input) {
            publishedPayload = input.payload;
          },
        },
        now: () => new Date('2026-02-20T20:00:00.000Z'),
        createEventId: () => 'event-789',
      }
    );

    if (!publishedPayload) {
      throw new Error('expected published payload to be captured');
    }

    const payloadSchema = getPublishPayloadSchema(contract, 'printers/{id}/jobs');
    const payloadMissingTraceId = { ...publishedPayload };
    delete (payloadMissingTraceId as { traceId?: string }).traceId;

    expect(() =>
      assertMatchesJsonSchema({
        contract,
        schema: payloadSchema,
        value: payloadMissingTraceId,
        subject: 'PrintJobCommandPayload',
      })
    ).toThrow('PrintJobCommandPayload.traceId is required');
  });
});
