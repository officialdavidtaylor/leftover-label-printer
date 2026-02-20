import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  COLLECTION_CONTRACTS,
  buildSchemaValidationFailureLog,
  toPrintJobAcceptedResponse,
  toPrintJobStatusResponse,
  validateJobEventDocument,
  validatePrinterDocument,
  validatePrintJobDocument,
  validateTemplateDocument,
} from '../../backend/src/data/schema-contracts.ts';
import {
  createJobEventDocument,
  createPrinterDocument,
  createPrintJobDocument,
  createTemplateDocument,
} from './fixtures/schema-fixtures.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

function stripField<T extends Record<string, unknown>>(value: T, field: keyof T): Partial<T> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

describe('schema-contracts', () => {
  it('declares append-only job_events collection', () => {
    const jobEventsContract = COLLECTION_CONTRACTS.find((entry) => entry.name === 'job_events');

    expect(jobEventsContract).toBeDefined();
    expect(jobEventsContract?.writeModel).toBe('append_only');
    expect(jobEventsContract?.requiredFields).toContain('eventId');
    expect(jobEventsContract?.requiredFields).toContain('traceId');
  });

  it('accepts representative documents for all collections', () => {
    expect(validatePrintJobDocument(createPrintJobDocument())).toMatchObject({ valid: true });
    expect(validateJobEventDocument(createJobEventDocument())).toMatchObject({ valid: true });
    expect(validatePrinterDocument(createPrinterDocument())).toMatchObject({ valid: true });
    expect(validateTemplateDocument(createTemplateDocument())).toMatchObject({ valid: true });
  });

  it('rejects missing required fields on print_jobs', () => {
    const result = validatePrintJobDocument(stripField(createPrintJobDocument(), 'printerId'));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failures.some((failure) => failure.field === 'printerId')).toBe(true);
    }
  });

  it('rejects invalid enum values and non-object payloads', () => {
    const result = validatePrintJobDocument({
      ...createPrintJobDocument(),
      state: 'queued',
      payload: 'not-an-object',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failures.some((failure) => failure.field === 'state')).toBe(true);
      expect(result.failures.some((failure) => failure.field === 'payload')).toBe(true);
    }
  });

  it('rejects invalid rendered PDF metadata shape when artifact metadata is present', () => {
    const result = validatePrintJobDocument({
      ...createPrintJobDocument(),
      renderedPdf: {
        bucket: '',
        key: 'rendered-pdfs/jobs/job-1/rendered.pdf',
        contentType: 'application/pdf',
        contentLength: -1,
        checksumSha256: 'abc123',
        uploadedAt: 'not-a-date',
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failures.some((failure) => failure.field === 'renderedPdf')).toBe(true);
    }
  });

  it('rejects invalid agent event shape and failed event without error details', () => {
    const result = validateJobEventDocument({
      ...createJobEventDocument(),
      type: 'failed',
      source: 'agent',
      printerId: undefined,
      outcome: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failures.some((failure) => failure.field === 'printerId')).toBe(true);
      expect(result.failures.some((failure) => failure.field === 'outcome')).toBe(true);
      expect(result.failures.some((failure) => failure.field === 'errorCode')).toBe(true);
      expect(result.failures.some((failure) => failure.field === 'errorMessage')).toBe(true);
    }
  });

  it('builds validation failure logs with traceId', () => {
    const result = validatePrintJobDocument({ ...createPrintJobDocument(), acceptedAt: 'not-a-date' });
    const log = buildSchemaValidationFailureLog('print_jobs', result, 'trace-123');

    expect(log).toMatchObject({
      level: 'warn',
      event: 'schema_validation_failed',
      collection: 'print_jobs',
      traceId: 'trace-123',
    });
    expect(log?.failures.some((failure) => failure.field === 'acceptedAt')).toBe(true);
  });
});

describe('schema-contracts-openapi-alignment', () => {
  it('maps print_jobs documents to accepted and status response shapes', () => {
    const job = createPrintJobDocument();
    const event = createJobEventDocument({ jobId: job.jobId, traceId: job.traceId });
    const accepted = toPrintJobAcceptedResponse(job);
    const status = toPrintJobStatusResponse(job, [event]);

    expect(accepted).toEqual({
      jobId: job.jobId,
      state: job.state,
      acceptedAt: job.acceptedAt,
      traceId: job.traceId,
    });
    expect(status).toMatchObject({
      jobId: job.jobId,
      state: job.state,
      printerId: job.printerId,
      templateId: job.templateId,
    });
    expect(status.events).toHaveLength(1);
  });

  it('keeps model response fields aligned with OpenAPI schema requirements', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');

    expect(openApiText).toContain('PrintJobAcceptedResponse:');
    expect(openApiText).toContain('PrintJobStatusResponse:');
    expect(openApiText).toContain('PrintJobEvent:');

    expect(openApiText).toContain('- acceptedAt');
    expect(openApiText).toContain('- printerId');
    expect(openApiText).toContain('- templateId');
    expect(openApiText).toContain('- events');

    expect(openApiText).toContain('- pending');
    expect(openApiText).toContain('- processing');
    expect(openApiText).toContain('- dispatched');
    expect(openApiText).toContain('- printed');
    expect(openApiText).toContain('- failed');
  });
});
