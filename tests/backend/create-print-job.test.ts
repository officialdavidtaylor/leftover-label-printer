import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  handleCreatePrintJob,
  type CreatePrintJobDependencies,
  type PersistedPrintJob,
} from '../../backend/src/api/create-print-job.ts';
import { DuplicateIdempotencyKeyError } from '../../backend/src/print-jobs/idempotent-submission.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

describe('create-print-job-handler', () => {
  it('accepts a valid submission and persists initial job/event records', async () => {
    const store = new InMemoryCreatePrintJobStore();

    const response = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-valid',
        traceId: 'trace-123',
        body: {
          idempotencyKey: 'idem-123',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Mayo' },
        },
      },
      createDeps({
        store,
        createJobId: () => 'job-123',
        createEventId: () => 'event-123',
      })
    );

    expect(response.status).toBe(202);
    if (response.status !== 202) {
      return;
    }

    expect(response.body).toEqual({
      jobId: 'job-123',
      state: 'pending',
      acceptedAt: '2026-02-20T20:00:00.000Z',
      traceId: 'trace-123',
    });

    expect(store.jobs).toHaveLength(1);
    expect(store.events).toHaveLength(1);
    expect(store.jobs[0]).toMatchObject({
      jobId: 'job-123',
      ownerUserId: 'user-123',
      idempotencyKey: 'idem-123',
      state: 'pending',
      printerId: 'printer-1',
      templateId: 'template-1',
      traceId: 'trace-123',
    });
    expect(store.events[0]).toEqual({
      eventId: 'event-123',
      jobId: 'job-123',
      type: 'pending',
      source: 'backend',
      occurredAt: '2026-02-20T20:00:00.000Z',
      traceId: 'trace-123',
    });
  });

  it('returns existing accepted job on duplicate idempotency key and skips writes', async () => {
    const store = new InMemoryCreatePrintJobStore([
      {
        jobId: 'job-existing',
        ownerUserId: 'user-123',
        idempotencyKey: 'idem-dup',
        state: 'pending',
        printerId: 'printer-1',
        templateId: 'template-1',
        payload: { itemName: 'Chili' },
        traceId: 'trace-existing',
        acceptedAt: '2026-02-20T20:00:00.000Z',
        createdAt: '2026-02-20T20:00:00.000Z',
        updatedAt: '2026-02-20T20:00:00.000Z',
      },
    ]);

    const response = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-valid',
        traceId: 'trace-retry',
        body: {
          idempotencyKey: 'idem-dup',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Chili' },
        },
      },
      createDeps({
        store,
        createJobId: () => 'job-should-not-be-used',
      })
    );

    expect(response.status).toBe(202);
    if (response.status !== 202) {
      return;
    }

    expect(response.body).toEqual({
      jobId: 'job-existing',
      state: 'pending',
      acceptedAt: '2026-02-20T20:00:00.000Z',
      traceId: 'trace-existing',
    });
    expect(store.insertAttempts).toBe(0);
    expect(store.jobs).toHaveLength(1);
  });

  it('handles duplicate race by replaying persisted accepted job', async () => {
    const store = new InMemoryCreatePrintJobStore([], true);

    const response = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-valid',
        traceId: 'trace-race',
        body: {
          idempotencyKey: 'idem-race',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Soup' },
        },
      },
      createDeps({
        store,
        createJobId: () => 'job-race-new',
      })
    );

    expect(response.status).toBe(202);
    if (response.status !== 202) {
      return;
    }

    expect(response.body.jobId).toBe('job-race-existing');
    expect(response.body.traceId).toBe('trace-race-existing');
    expect(store.insertAttempts).toBe(1);
  });

  it('returns 400 when payload is invalid', async () => {
    const response = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-valid',
        traceId: 'trace-400',
        body: {
          idempotencyKey: 'idem-invalid',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: 'not-an-object',
        },
      },
      createDeps({
        store: new InMemoryCreatePrintJobStore(),
      })
    );

    expect(response).toEqual({
      status: 400,
      body: {
        code: 'validation_error',
        message: 'Validation error',
        traceId: 'trace-400',
      },
    });
  });

  it('returns 400 when referenced printer or template cannot be found', async () => {
    const response = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-valid',
        traceId: 'trace-400-reference',
        body: {
          idempotencyKey: 'idem-invalid-ref',
          printerId: 'printer-missing',
          templateId: 'template-missing',
          payload: { itemName: 'Stew' },
        },
      },
      createDeps({
        store: new InMemoryCreatePrintJobStore([], false, {
          printers: ['printer-1'],
          templates: ['template-1'],
        }),
      })
    );

    expect(response).toEqual({
      status: 400,
      body: {
        code: 'validation_error',
        message: 'Validation error',
        traceId: 'trace-400-reference',
      },
    });
  });

  it('returns 401 for missing or invalid bearer tokens', async () => {
    const missingAuthResponse = await handleCreatePrintJob(
      {
        traceId: 'trace-401-missing',
        body: {
          idempotencyKey: 'idem-401',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Salsa' },
        },
      },
      createDeps({
        store: new InMemoryCreatePrintJobStore(),
      })
    );

    const invalidAuthResponse = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-invalid',
        traceId: 'trace-401-invalid',
        body: {
          idempotencyKey: 'idem-401',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Salsa' },
        },
      },
      createDeps({
        store: new InMemoryCreatePrintJobStore(),
      })
    );

    expect(missingAuthResponse).toEqual({
      status: 401,
      body: {
        code: 'unauthorized',
        message: 'Unauthorized',
        traceId: 'trace-401-missing',
      },
    });

    expect(invalidAuthResponse).toEqual({
      status: 401,
      body: {
        code: 'unauthorized',
        message: 'Unauthorized',
        traceId: 'trace-401-invalid',
      },
    });
  });

  it('returns 403 when caller lacks required role', async () => {
    const response = await handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-no-role',
        traceId: 'trace-403',
        body: {
          idempotencyKey: 'idem-403',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Pasta' },
        },
      },
      createDeps({
        store: new InMemoryCreatePrintJobStore(),
      })
    );

    expect(response).toEqual({
      status: 403,
      body: {
        code: 'forbidden',
        message: 'Forbidden',
        traceId: 'trace-403',
      },
    });
  });
});

describe('create-print-job-openapi-alignment', () => {
  it('declares 202, 400, 401, and 403 responses for POST /v1/print-jobs', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');

    expect(openApiText).toContain('/v1/print-jobs:');
    expect(openApiText).toContain("'202':");
    expect(openApiText).toContain("'400':");
    expect(openApiText).toContain("'401':");
    expect(openApiText).toContain("'403':");
    expect(openApiText).toContain("$ref: '#/components/schemas/PrintJobAcceptedResponse'");
    expect(openApiText).toContain("$ref: '#/components/schemas/ErrorResponse'");
  });
});

function createDeps(overrides: {
  store: InMemoryCreatePrintJobStore;
  createJobId?: () => string;
  createEventId?: () => string;
}): CreatePrintJobDependencies {
  return {
    authVerifier: {
      async verifyAccessToken(token) {
        if (token === 'token-invalid') {
          throw new Error('invalid');
        }

        if (token === 'token-no-role') {
          return {
            subject: 'user-123',
            issuer: 'https://issuer.example.com',
            audience: ['leftover-label-printer'],
            roles: ['viewer'],
            expiresAt: 9_999_999_999,
            claims: {},
          };
        }

        return {
          subject: 'user-123',
          issuer: 'https://issuer.example.com',
          audience: ['leftover-label-printer'],
          roles: ['user'],
          expiresAt: 9_999_999_999,
          claims: {},
        };
      },
    },
    store: overrides.store,
    now: () => new Date('2026-02-20T20:00:00.000Z'),
    createJobId: overrides.createJobId,
    createEventId: overrides.createEventId,
  };
}

class InMemoryCreatePrintJobStore {
  private readonly jobsByIdempotencyKey = new Map<string, PersistedPrintJob>();
  readonly jobs: PersistedPrintJob[] = [];
  readonly events: Array<{
    eventId: string;
    jobId: string;
    type: 'pending';
    source: 'backend';
    occurredAt: string;
    traceId: string;
  }> = [];
  insertAttempts = 0;

  private readonly printers: Set<string>;
  private readonly templates: Set<string>;

  constructor(
    seed: PersistedPrintJob[] = [],
    private readonly throwDuplicateOnInsert = false,
    lookupSeed: {
      printers: string[];
      templates: string[];
    } = {
      printers: ['printer-1'],
      templates: ['template-1'],
    }
  ) {
    this.printers = new Set(lookupSeed.printers);
    this.templates = new Set(lookupSeed.templates);

    for (const job of seed) {
      this.jobsByIdempotencyKey.set(job.idempotencyKey, job);
      this.jobs.push(job);
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<PersistedPrintJob | null> {
    return this.jobsByIdempotencyKey.get(idempotencyKey) ?? null;
  }

  async insertAccepted(data: {
    job: PersistedPrintJob;
    event: {
      eventId: string;
      jobId: string;
      type: 'pending';
      source: 'backend';
      occurredAt: string;
      traceId: string;
    };
  }): Promise<void> {
    this.insertAttempts += 1;

    if (this.throwDuplicateOnInsert) {
      const duplicatedJob: PersistedPrintJob = {
        ...data.job,
        jobId: 'job-race-existing',
        traceId: 'trace-race-existing',
      };
      this.jobsByIdempotencyKey.set(data.job.idempotencyKey, duplicatedJob);
      throw new DuplicateIdempotencyKeyError(data.job.idempotencyKey);
    }

    if (this.jobsByIdempotencyKey.has(data.job.idempotencyKey)) {
      throw new DuplicateIdempotencyKeyError(data.job.idempotencyKey);
    }

    this.jobsByIdempotencyKey.set(data.job.idempotencyKey, data.job);
    this.jobs.push(data.job);
    this.events.push(data.event);
  }

  async printerExists(printerId: string): Promise<boolean> {
    return this.printers.has(printerId);
  }

  async templateExists(templateId: string): Promise<boolean> {
    return this.templates.has(templateId);
  }
}
