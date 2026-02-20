import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  COLLECTION_CONTRACTS,
  EXAMPLE_JOB_EVENT_DOCUMENT,
  EXAMPLE_PRINTER_DOCUMENT,
  EXAMPLE_PRINT_JOB_DOCUMENT,
  EXAMPLE_TEMPLATE_DOCUMENT,
  buildSchemaValidationFailureLog,
  toPrintJobAcceptedResponse,
  toPrintJobStatusResponse,
  validateJobEventDocument,
  validatePrinterDocument,
  validatePrintJobDocument,
  validateTemplateDocument,
} from '../../backend/src/data/schema-contracts.ts';

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
    expect(validatePrintJobDocument(EXAMPLE_PRINT_JOB_DOCUMENT)).toMatchObject({ valid: true });
    expect(validateJobEventDocument(EXAMPLE_JOB_EVENT_DOCUMENT)).toMatchObject({ valid: true });
    expect(validatePrinterDocument(EXAMPLE_PRINTER_DOCUMENT)).toMatchObject({ valid: true });
    expect(validateTemplateDocument(EXAMPLE_TEMPLATE_DOCUMENT)).toMatchObject({ valid: true });
  });

  it('rejects missing required fields on print_jobs', () => {
    const result = validatePrintJobDocument(stripField(EXAMPLE_PRINT_JOB_DOCUMENT, 'printerId'));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failures).toContainEqual({
        field: 'printerId',
        message: 'expected non-empty string',
      });
    }
  });

  it('rejects invalid enum values and non-object payloads', () => {
    const result = validatePrintJobDocument({
      ...EXAMPLE_PRINT_JOB_DOCUMENT,
      state: 'queued',
      payload: 'not-an-object',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failures.some((failure) => failure.field === 'state')).toBe(true);
      expect(result.failures.some((failure) => failure.field === 'payload')).toBe(true);
    }
  });

  it('rejects invalid agent event shape and failed event without error details', () => {
    const result = validateJobEventDocument({
      ...EXAMPLE_JOB_EVENT_DOCUMENT,
      type: 'failed',
      source: 'agent',
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
    const result = validatePrintJobDocument({ ...EXAMPLE_PRINT_JOB_DOCUMENT, acceptedAt: 'not-a-date' });
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
    const accepted = toPrintJobAcceptedResponse(EXAMPLE_PRINT_JOB_DOCUMENT);
    const status = toPrintJobStatusResponse(EXAMPLE_PRINT_JOB_DOCUMENT, [EXAMPLE_JOB_EVENT_DOCUMENT]);

    expect(accepted).toEqual({
      jobId: EXAMPLE_PRINT_JOB_DOCUMENT.jobId,
      state: EXAMPLE_PRINT_JOB_DOCUMENT.state,
      acceptedAt: EXAMPLE_PRINT_JOB_DOCUMENT.acceptedAt,
      traceId: EXAMPLE_PRINT_JOB_DOCUMENT.traceId,
    });
    expect(status).toMatchObject({
      jobId: EXAMPLE_PRINT_JOB_DOCUMENT.jobId,
      state: EXAMPLE_PRINT_JOB_DOCUMENT.state,
      printerId: EXAMPLE_PRINT_JOB_DOCUMENT.printerId,
      templateId: EXAMPLE_PRINT_JOB_DOCUMENT.templateId,
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
