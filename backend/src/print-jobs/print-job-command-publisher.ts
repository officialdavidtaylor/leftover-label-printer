import { randomUUID } from 'node:crypto';

import { z } from 'zod';

const DEFAULT_SCHEMA_VERSION = '1.0.0';

const schemaVersionSchema = z.string().trim().regex(/^1\.[0-9]+\.[0-9]+$/);
const isoTimestampSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'expected ISO-8601 timestamp',
  });

const publishPrintJobCommandInputSchema = z.object({
  jobId: z.string().trim().min(1),
  printerId: z.string().trim().min(1),
  traceId: z.string().trim().min(1),
  objectUrl: z.string().trim().url(),
  issuedAt: isoTimestampSchema.optional(),
});

const printJobCommandPayloadSchema = z.object({
  schemaVersion: schemaVersionSchema,
  type: z.literal('print_job_dispatch'),
  eventId: z.string().trim().min(1),
  traceId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  printerId: z.string().trim().min(1),
  objectUrl: z.string().trim().url(),
  issuedAt: isoTimestampSchema,
});

export type PrintJobCommandPayload = z.infer<typeof printJobCommandPayloadSchema>;

export type PublishPrintJobCommandInput = z.infer<typeof publishPrintJobCommandInputSchema>;

export interface PrintJobCommandPublisher {
  publish(input: {
    topic: string;
    qos: 1;
    payload: PrintJobCommandPayload;
  }): Promise<void>;
}

export type PublishPrintJobCommandResult = {
  topic: string;
  qos: 1;
  payload: PrintJobCommandPayload;
};

export async function publishPrintJobCommand(
  input: PublishPrintJobCommandInput,
  deps: {
    publisher: PrintJobCommandPublisher;
    schemaVersion?: string;
    now?: () => Date;
    createEventId?: () => string;
  }
): Promise<PublishPrintJobCommandResult> {
  const parsedInput = publishPrintJobCommandInputSchema.parse(input);
  const issuedAt = parsedInput.issuedAt ?? (deps.now?.() ?? new Date()).toISOString();
  const eventId = deps.createEventId?.() ?? `event-${randomUUID()}`;
  const schemaVersion = schemaVersionSchema.parse(deps.schemaVersion ?? DEFAULT_SCHEMA_VERSION);
  const topic = buildPrinterJobsTopic(parsedInput.printerId);

  const payload = printJobCommandPayloadSchema.parse({
    schemaVersion,
    type: 'print_job_dispatch',
    eventId,
    traceId: parsedInput.traceId,
    jobId: parsedInput.jobId,
    printerId: parsedInput.printerId,
    objectUrl: parsedInput.objectUrl,
    issuedAt,
  });

  await deps.publisher.publish({
    topic,
    qos: 1,
    payload,
  });

  return {
    topic,
    qos: 1,
    payload,
  };
}

export function buildPrinterJobsTopic(printerId: string): string {
  const normalizedPrinterId = z.string().trim().min(1).parse(printerId);
  return `printers/${normalizedPrinterId}/jobs`;
}
