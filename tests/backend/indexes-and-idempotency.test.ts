import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CRITICAL_INDEX_CONTRACTS,
  IDEMPOTENCY_UNIQUENESS_SCOPE,
  findIndexContract,
} from '../../backend/src/data/index-contracts.ts';
import {
  DuplicateIdempotencyKeyError,
  type PrintJobRecord,
  submitPrintJobIdempotently,
} from '../../backend/src/print-jobs/idempotent-submission.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

describe('index-contracts', () => {
  it('defines critical lookup indexes for status, printer, and event timeline', () => {
    expect(findIndexContract('print_jobs_state_acceptedAt_desc')).toMatchObject({
      collection: 'print_jobs',
      key: { state: 1, acceptedAt: -1 },
    });

    expect(findIndexContract('print_jobs_printerId_acceptedAt_desc')).toMatchObject({
      collection: 'print_jobs',
      key: { printerId: 1, acceptedAt: -1 },
    });

    expect(findIndexContract('job_events_jobId_occurredAt_asc')).toMatchObject({
      collection: 'job_events',
      key: { jobId: 1, occurredAt: 1 },
    });
  });

  it('enforces idempotency uniqueness with a unique print_jobs index', () => {
    const idempotencyIndex = findIndexContract('print_jobs_idempotencyKey_unique');

    expect(idempotencyIndex).toMatchObject({
      collection: 'print_jobs',
      key: { idempotencyKey: 1 },
      unique: true,
    });
    expect(IDEMPOTENCY_UNIQUENESS_SCOPE).toBe('global-idempotency-key');
  });

  it('keeps a bounded set of critical indexes', () => {
    expect(CRITICAL_INDEX_CONTRACTS.length).toBe(5);
  });
});

describe('idempotent-submission', () => {
  it('creates a new job on first idempotency key use', async () => {
    const store = new InMemoryPrintJobStore();

    const result = await submitPrintJobIdempotently(
      {
        idempotencyKey: 'idem-123',
        printerId: 'printer-1',
        templateId: 'template-1',
        traceId: 'trace-1',
        acceptedAt: '2026-02-20T16:00:00.000Z',
      },
      {
        store,
        createJobId: () => 'job-new',
      }
    );

    expect(result.duplicate).toBe(false);
    expect(result.job.jobId).toBe('job-new');
    expect(result.response).toEqual({
      jobId: 'job-new',
      state: 'pending',
      acceptedAt: '2026-02-20T16:00:00.000Z',
      traceId: 'trace-1',
    });
    expect(store.insertCount).toBe(1);
  });

  it('returns the existing accepted job for duplicate idempotency key', async () => {
    const existing: PrintJobRecord = {
      jobId: 'job-existing',
      idempotencyKey: 'idem-123',
      printerId: 'printer-1',
      templateId: 'template-1',
      state: 'pending',
      acceptedAt: '2026-02-20T16:00:00.000Z',
      traceId: 'trace-existing',
    };

    const store = new InMemoryPrintJobStore([existing]);
    const duplicates: string[] = [];

    const result = await submitPrintJobIdempotently(
      {
        idempotencyKey: 'idem-123',
        printerId: 'printer-1',
        templateId: 'template-1',
        traceId: 'trace-2',
        acceptedAt: '2026-02-20T16:05:00.000Z',
      },
      {
        store,
        createJobId: () => 'job-should-not-be-created',
        onDuplicate: (entry) => duplicates.push(entry.jobId),
      }
    );

    expect(result.duplicate).toBe(true);
    expect(result.job.jobId).toBe('job-existing');
    expect(result.response.jobId).toBe('job-existing');
    expect(result.response.acceptedAt).toBe(existing.acceptedAt);
    expect(store.insertCount).toBe(0);
    expect(duplicates).toEqual(['job-existing']);
  });

  it('handles duplicate-key race by returning persisted existing job', async () => {
    const store = new InMemoryPrintJobStore([], true);

    const result = await submitPrintJobIdempotently(
      {
        idempotencyKey: 'idem-race',
        printerId: 'printer-1',
        templateId: 'template-1',
        traceId: 'trace-race',
        acceptedAt: '2026-02-20T16:10:00.000Z',
      },
      {
        store,
        createJobId: () => 'job-race-1',
      }
    );

    expect(result.duplicate).toBe(true);
    expect(result.job.jobId).toBe('job-race-existing');
    expect(store.insertCount).toBe(1);
  });
});

describe('idempotent-submission-openapi-alignment', () => {
  it('keeps create endpoint response aligned with accepted job contract', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');

    expect(openApiText).toContain('/v1/print-jobs:');
    expect(openApiText).toContain("'202':");
    expect(openApiText).toContain("$ref: '#/components/schemas/PrintJobAcceptedResponse'");
    expect(openApiText).toContain('PrintJobAcceptedResponse:');
    expect(openApiText).toContain('- jobId');
    expect(openApiText).toContain('- state');
    expect(openApiText).toContain('- acceptedAt');
  });
});

class InMemoryPrintJobStore {
  private readonly jobsByIdempotencyKey = new Map<string, PrintJobRecord>();
  insertCount = 0;

  constructor(seed: PrintJobRecord[] = [], private readonly throwDuplicateOnInsert = false) {
    for (const job of seed) {
      this.jobsByIdempotencyKey.set(job.idempotencyKey, job);
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<PrintJobRecord | null> {
    return this.jobsByIdempotencyKey.get(idempotencyKey) ?? null;
  }

  async insert(job: PrintJobRecord): Promise<void> {
    this.insertCount += 1;

    if (this.throwDuplicateOnInsert) {
      this.jobsByIdempotencyKey.set(job.idempotencyKey, {
        ...job,
        jobId: 'job-race-existing',
      });
      throw new DuplicateIdempotencyKeyError(job.idempotencyKey);
    }

    if (this.jobsByIdempotencyKey.has(job.idempotencyKey)) {
      throw new DuplicateIdempotencyKeyError(job.idempotencyKey);
    }

    this.jobsByIdempotencyKey.set(job.idempotencyKey, job);
  }
}
