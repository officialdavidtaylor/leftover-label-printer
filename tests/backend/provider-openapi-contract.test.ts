import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  handleCreatePrintJob,
  type CreatePrintJobDependencies,
  type PersistedPrintJob,
} from '../../backend/src/api/create-print-job.ts';
import {
  handleGetPrintJobStatus,
  type GetPrintJobStatusDependencies,
  type PersistedPrintJobForStatus,
} from '../../backend/src/api/get-print-job-status.ts';
import type { JobEventDocument } from '../../backend/src/data/schema-contracts.ts';
import {
  assertJsonResponseMatchesContract,
  getDeclaredResponseStatusCodes,
  loadOpenApiProviderContract,
  type OpenApiProviderContract,
} from './helpers/openapi-provider-contract.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

let contract: OpenApiProviderContract;

beforeAll(async () => {
  contract = await loadOpenApiProviderContract(openApiPath);
});

describe('provider-openapi-contract:createPrintJob', () => {
  it('covers all declared success/error statuses and validates response schemas', async () => {
    const scenarios = await runCreatePrintJobScenarios();

    for (const scenario of scenarios) {
      assertJsonResponseMatchesContract({
        contract,
        routePath: '/v1/print-jobs',
        method: 'post',
        status: scenario.response.status,
        body: scenario.response.body,
      });
    }

    const observedStatuses = Array.from(new Set(scenarios.map((scenario) => scenario.response.status))).sort(
      (left, right) => left - right
    );

    expect(observedStatuses).toEqual([202, 400, 401, 403]);
    expect(getDeclaredResponseStatusCodes(contract, '/v1/print-jobs', 'post')).toEqual([202, 400, 401, 403]);
  });
});

describe('provider-openapi-contract:getPrintJob', () => {
  it('covers all declared success/error statuses and validates response schemas', async () => {
    const scenarios = await runGetPrintJobScenarios();

    for (const scenario of scenarios) {
      assertJsonResponseMatchesContract({
        contract,
        routePath: '/v1/print-jobs/{jobId}',
        method: 'get',
        status: scenario.response.status,
        body: scenario.response.body,
      });
    }

    const observedStatuses = Array.from(new Set(scenarios.map((scenario) => scenario.response.status))).sort(
      (left, right) => left - right
    );

    expect(observedStatuses).toEqual([200, 401, 403, 404]);
    expect(getDeclaredResponseStatusCodes(contract, '/v1/print-jobs/{jobId}', 'get')).toEqual([
      200, 401, 403, 404,
    ]);
  });
});

async function runCreatePrintJobScenarios(): Promise<
  Array<{
    name: string;
    response: Awaited<ReturnType<typeof handleCreatePrintJob>>;
  }>
> {
  const acceptedStore = new InMemoryCreateStore();
  const accepted = await handleCreatePrintJob(
    {
      authorizationHeader: 'Bearer token-user',
      traceId: 'trace-create-accepted',
      body: {
        idempotencyKey: 'idem-accepted',
        printerId: 'printer-1',
        templateId: 'template-1',
        payload: { itemName: 'Soup' },
      },
    },
    createCreateDeps({
      store: acceptedStore,
      nowIso: '2026-02-20T20:00:00.000Z',
    })
  );

  const validation = await handleCreatePrintJob(
    {
      authorizationHeader: 'Bearer token-user',
      traceId: 'trace-create-validation',
      body: {
        idempotencyKey: 'idem-bad',
        printerId: 'printer-1',
        templateId: 'template-1',
        payload: 'not-an-object',
      },
    },
    createCreateDeps({
      store: new InMemoryCreateStore(),
      nowIso: '2026-02-20T20:00:00.000Z',
    })
  );

  const unauthorized = await handleCreatePrintJob(
    {
      traceId: 'trace-create-unauthorized',
      body: {
        idempotencyKey: 'idem-unauthorized',
        printerId: 'printer-1',
        templateId: 'template-1',
        payload: { itemName: 'Salsa' },
      },
    },
    createCreateDeps({
      store: new InMemoryCreateStore(),
      nowIso: '2026-02-20T20:00:00.000Z',
    })
  );

  const forbidden = await handleCreatePrintJob(
    {
      authorizationHeader: 'Bearer token-no-role',
      traceId: 'trace-create-forbidden',
      body: {
        idempotencyKey: 'idem-forbidden',
        printerId: 'printer-1',
        templateId: 'template-1',
        payload: { itemName: 'Stew' },
      },
    },
    createCreateDeps({
      store: new InMemoryCreateStore(),
      nowIso: '2026-02-20T20:00:00.000Z',
    })
  );

  return [
    { name: 'accepted', response: accepted },
    { name: 'validation', response: validation },
    { name: 'unauthorized', response: unauthorized },
    { name: 'forbidden', response: forbidden },
  ];
}

async function runGetPrintJobScenarios(): Promise<
  Array<{
    name: string;
    response: Awaited<ReturnType<typeof handleGetPrintJobStatus>>;
  }>
> {
  const seededJob: PersistedPrintJobForStatus = {
    jobId: 'job-123',
    ownerUserId: 'user-owner',
    state: 'processing',
    printerId: 'printer-1',
    templateId: 'template-1',
    templateVersion: 'v2',
  };
  const seededEvents: JobEventDocument[] = [
    {
      eventId: 'event-1',
      jobId: 'job-123',
      type: 'pending',
      source: 'backend',
      occurredAt: '2026-02-20T20:00:00.000Z',
      traceId: 'trace-get-200',
    },
  ];

  const success = await handleGetPrintJobStatus(
    {
      authorizationHeader: 'Bearer token-owner',
      traceId: 'trace-get-success',
      jobId: 'job-123',
    },
    createGetDeps({
      store: new InMemoryStatusStore([seededJob], seededEvents),
    })
  );

  const unauthorized = await handleGetPrintJobStatus(
    {
      traceId: 'trace-get-unauthorized',
      jobId: 'job-123',
    },
    createGetDeps({
      store: new InMemoryStatusStore([seededJob], seededEvents),
    })
  );

  const forbidden = await handleGetPrintJobStatus(
    {
      authorizationHeader: 'Bearer token-other-user',
      traceId: 'trace-get-forbidden',
      jobId: 'job-123',
    },
    createGetDeps({
      store: new InMemoryStatusStore([seededJob], seededEvents),
    })
  );

  const notFound = await handleGetPrintJobStatus(
    {
      authorizationHeader: 'Bearer token-owner',
      traceId: 'trace-get-not-found',
      jobId: 'job-missing',
    },
    createGetDeps({
      store: new InMemoryStatusStore([], []),
    })
  );

  return [
    { name: 'success', response: success },
    { name: 'unauthorized', response: unauthorized },
    { name: 'forbidden', response: forbidden },
    { name: 'notFound', response: notFound },
  ];
}

function createCreateDeps(overrides: {
  store: InMemoryCreateStore;
  nowIso: string;
}): CreatePrintJobDependencies {
  return {
    authVerifier: {
      async verifyAccessToken(token) {
        if (token === 'token-invalid') {
          throw new Error('invalid-token');
        }

        if (token === 'token-no-role') {
          return {
            subject: 'user-owner',
            issuer: 'https://issuer.example.com',
            audience: ['leftover-label-printer'],
            roles: [],
            expiresAt: 9_999_999_999,
            claims: {},
          };
        }

        return {
          subject: 'user-owner',
          issuer: 'https://issuer.example.com',
          audience: ['leftover-label-printer'],
          roles: ['user'],
          expiresAt: 9_999_999_999,
          claims: {},
        };
      },
    },
    store: overrides.store,
    renderedPdfBucket: 'rendered-pdfs',
    renderPdf: async () => ({
      contentType: 'application/pdf',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    }),
    uploadRenderedPdf: async (input) => ({
      bucket: input.bucket,
      key: `rendered-pdfs/jobs/${input.jobId}/rendered.pdf`,
      contentType: input.contentType,
      contentLength: input.pdf.byteLength,
      checksumSha256: 'checksum-provider',
      uploadedAt: overrides.nowIso,
    }),
    createRenderedPdfDownloadUrl: async (input) => ({
      url: `https://objects.example.com/signed/${input.jobId}?sig=provider`,
      expiresAt: '2026-02-20T20:02:00.000Z',
      ttlSeconds: 120,
    }),
    commandPublisher: {
      async publish() {
        return;
      },
    },
    now: () => new Date(overrides.nowIso),
    createJobId: () => 'job-accepted',
    createEventId: () => 'event-accepted',
    createCommandEventId: () => 'event-dispatch',
  };
}

function createGetDeps(overrides: {
  store: InMemoryStatusStore;
}): GetPrintJobStatusDependencies {
  return {
    authVerifier: {
      async verifyAccessToken(token) {
        if (token === 'token-invalid') {
          throw new Error('invalid-token');
        }

        if (token === 'token-other-user') {
          return {
            subject: 'user-other',
            issuer: 'https://issuer.example.com',
            audience: ['leftover-label-printer'],
            roles: ['user'],
            expiresAt: 9_999_999_999,
            claims: {},
          };
        }

        return {
          subject: 'user-owner',
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

class InMemoryCreateStore {
  private readonly jobsByIdempotency = new Map<string, PersistedPrintJob>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<PersistedPrintJob | null> {
    return this.jobsByIdempotency.get(idempotencyKey) ?? null;
  }

  async insertAccepted(data: { job: PersistedPrintJob; event: JobEventDocument }): Promise<void> {
    void data.event;
    this.jobsByIdempotency.set(data.job.idempotencyKey, data.job);
  }

  async printerExists(printerId: string): Promise<boolean> {
    return printerId === 'printer-1';
  }

  async templateExists(templateId: string, templateVersion?: string): Promise<boolean> {
    void templateVersion;
    return templateId === 'template-1';
  }
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
