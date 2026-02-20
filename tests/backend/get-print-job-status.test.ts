import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  handleGetPrintJobStatus,
  type GetPrintJobStatusDependencies,
  type PersistedPrintJobForStatus,
} from '../../backend/src/api/get-print-job-status.ts';
import type { JobEventDocument } from '../../backend/src/data/schema-contracts.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

describe('get-print-job-status-handler', () => {
  it('returns 200 with deterministic ordered events for job owner', async () => {
    const job: PersistedPrintJobForStatus = {
      jobId: 'job-123',
      ownerUserId: 'user-123',
      state: 'processing',
      printerId: 'printer-1',
      templateId: 'template-1',
      templateVersion: 'v2',
    };

    const events: JobEventDocument[] = [
      {
        eventId: 'event-2',
        jobId: 'job-123',
        type: 'processing',
        source: 'backend',
        occurredAt: '2026-02-20T20:02:00.000Z',
        traceId: 'trace-123',
      },
      {
        eventId: 'event-1b',
        jobId: 'job-123',
        type: 'pending',
        source: 'backend',
        occurredAt: '2026-02-20T20:00:00.000Z',
        traceId: 'trace-123',
      },
      {
        eventId: 'event-1a',
        jobId: 'job-123',
        type: 'pending',
        source: 'backend',
        occurredAt: '2026-02-20T20:00:00.000Z',
        traceId: 'trace-123',
      },
    ];

    const response = await handleGetPrintJobStatus(
      {
        authorizationHeader: 'Bearer token-user-owner',
        traceId: 'trace-read',
        jobId: 'job-123',
      },
      createDeps({
        store: new InMemoryStatusStore([job], events),
      })
    );

    expect(response.status).toBe(200);
    if (response.status !== 200) {
      return;
    }

    expect(response.body).toMatchObject({
      jobId: 'job-123',
      state: 'processing',
      printerId: 'printer-1',
      templateId: 'template-1',
      templateVersion: 'v2',
    });
    expect(response.body.events.map((event) => event.eventId)).toEqual([
      'event-1a',
      'event-1b',
      'event-2',
    ]);
  });

  it('returns 200 for sysadmin cross-user access', async () => {
    const response = await handleGetPrintJobStatus(
      {
        authorizationHeader: 'Bearer token-sysadmin',
        traceId: 'trace-admin',
        jobId: 'job-foreign',
      },
      createDeps({
        store: new InMemoryStatusStore(
          [
            {
              jobId: 'job-foreign',
              ownerUserId: 'user-other',
              state: 'dispatched',
              printerId: 'printer-2',
              templateId: 'template-2',
            },
          ],
          []
        ),
      })
    );

    expect(response.status).toBe(200);
    if (response.status !== 200) {
      return;
    }

    expect(response.body.jobId).toBe('job-foreign');
    expect(response.body.events).toEqual([]);
  });

  it('returns 404 when job does not exist', async () => {
    const response = await handleGetPrintJobStatus(
      {
        authorizationHeader: 'Bearer token-user-owner',
        traceId: 'trace-404',
        jobId: 'job-missing',
      },
      createDeps({
        store: new InMemoryStatusStore([], []),
      })
    );

    expect(response).toEqual({
      status: 404,
      body: {
        code: 'not_found',
        message: 'Print job not found',
        traceId: 'trace-404',
      },
    });
  });

  it('returns 403 for non-owner user access', async () => {
    const response = await handleGetPrintJobStatus(
      {
        authorizationHeader: 'Bearer token-user-owner',
        traceId: 'trace-403',
        jobId: 'job-foreign',
      },
      createDeps({
        store: new InMemoryStatusStore(
          [
            {
              jobId: 'job-foreign',
              ownerUserId: 'user-other',
              state: 'pending',
              printerId: 'printer-1',
              templateId: 'template-1',
            },
          ],
          []
        ),
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

  it('returns 401 for missing or invalid bearer token', async () => {
    const missingAuthResponse = await handleGetPrintJobStatus(
      {
        traceId: 'trace-401-missing',
        jobId: 'job-123',
      },
      createDeps({
        store: new InMemoryStatusStore([], []),
      })
    );

    const invalidAuthResponse = await handleGetPrintJobStatus(
      {
        authorizationHeader: 'Bearer token-invalid',
        traceId: 'trace-401-invalid',
        jobId: 'job-123',
      },
      createDeps({
        store: new InMemoryStatusStore([], []),
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
});

describe('get-print-job-status-openapi-alignment', () => {
  it('declares 200, 401, 403, and 404 responses for GET /v1/print-jobs/{jobId}', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');

    expect(openApiText).toContain('/v1/print-jobs/{jobId}:');
    expect(openApiText).toContain("'200':");
    expect(openApiText).toContain("'401':");
    expect(openApiText).toContain("'403':");
    expect(openApiText).toContain("'404':");
    expect(openApiText).toContain("$ref: '#/components/schemas/PrintJobStatusResponse'");
    expect(openApiText).toContain("$ref: '#/components/schemas/ErrorResponse'");
  });
});

function createDeps(overrides: {
  store: InMemoryStatusStore;
}): GetPrintJobStatusDependencies {
  return {
    authVerifier: {
      async verifyAccessToken(token) {
        if (token === 'token-invalid') {
          throw new Error('invalid');
        }

        if (token === 'token-sysadmin') {
          return {
            subject: 'sysadmin-123',
            issuer: 'https://issuer.example.com',
            audience: ['leftover-label-printer'],
            roles: ['sysadmin'],
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
  };
}

class InMemoryStatusStore {
  private readonly jobs = new Map<string, PersistedPrintJobForStatus>();
  private readonly events = new Map<string, JobEventDocument[]>();

  constructor(seedJobs: PersistedPrintJobForStatus[], seedEvents: JobEventDocument[]) {
    for (const job of seedJobs) {
      this.jobs.set(job.jobId, job);
    }

    for (const event of seedEvents) {
      const existing = this.events.get(event.jobId) ?? [];
      existing.push(event);
      this.events.set(event.jobId, existing);
    }
  }

  async findByJobId(jobId: string): Promise<PersistedPrintJobForStatus | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async listEventsForJob(jobId: string): Promise<JobEventDocument[]> {
    return this.events.get(jobId) ?? [];
  }
}
