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
    const dispatchSpy = createDispatchSpy();
    store.onInsertAccepted = () => dispatchSpy.steps.push('insertAccepted');

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
        createCommandEventId: () => 'event-dispatch-1',
        dispatchSpy,
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

    expect(dispatchSpy.steps).toEqual([
      'insertAccepted',
      'renderPdf',
      'uploadRenderedPdf',
      'createRenderedPdfDownloadUrl',
      'publishPrintJobCommand',
    ]);
    expect(dispatchSpy.renderInputs).toEqual([
      {
        templateId: 'template-1',
        templateVersion: 'v1',
        payload: { itemName: 'Mayo' },
      },
    ]);
    expect(dispatchSpy.uploadInputs[0]).toMatchObject({
      jobId: 'job-123',
      printerId: 'printer-1',
      templateId: 'template-1',
      templateVersion: 'v1',
      bucket: 'rendered-pdfs',
      contentType: 'application/pdf',
    });
    expect(dispatchSpy.downloadUrlInputs).toEqual([
      {
        jobId: 'job-123',
        renderedPdf: {
          bucket: 'rendered-pdfs',
          key: 'rendered-pdfs/jobs/job-123/rendered.pdf',
        },
      },
    ]);
    expect(dispatchSpy.publishInputs).toEqual([
      {
        topic: 'printers/printer-1/jobs',
        qos: 1,
        payload: {
          schemaVersion: '1.0.0',
          type: 'print_job_dispatch',
          eventId: 'event-dispatch-1',
          traceId: 'trace-123',
          jobId: 'job-123',
          printerId: 'printer-1',
          objectUrl: 'https://objects.example.com/signed/job-123?sig=abc',
          issuedAt: '2026-02-20T20:00:00.000Z',
        },
      },
    ]);
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
    const dispatchSpy = createDispatchSpy();

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
        dispatchSpy,
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
    expect(dispatchSpy.steps).toEqual([]);
  });

  it('handles duplicate race by replaying persisted accepted job', async () => {
    const store = new InMemoryCreatePrintJobStore([], true);
    const dispatchSpy = createDispatchSpy();

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
        dispatchSpy,
      })
    );

    expect(response.status).toBe(202);
    if (response.status !== 202) {
      return;
    }

    expect(response.body.jobId).toBe('job-race-existing');
    expect(response.body.traceId).toBe('trace-race-existing');
    expect(store.insertAttempts).toBe(1);
    expect(dispatchSpy.steps).toEqual([]);
  });

  it('does not publish command when rendered PDF upload fails', async () => {
    const store = new InMemoryCreatePrintJobStore();
    const dispatchSpy = createDispatchSpy();
    store.onInsertAccepted = () => dispatchSpy.steps.push('insertAccepted');

    const response = handleCreatePrintJob(
      {
        authorizationHeader: 'Bearer token-valid',
        traceId: 'trace-upload-failure',
        body: {
          idempotencyKey: 'idem-upload-failure',
          printerId: 'printer-1',
          templateId: 'template-1',
          payload: { itemName: 'Soup' },
        },
      },
      createDeps({
        store,
        dispatchSpy,
        uploadRenderedPdf: async (input) => {
          dispatchSpy.steps.push('uploadRenderedPdf');
          dispatchSpy.uploadInputs.push(input);
          throw new Error('upload failed');
        },
      })
    );

    await expect(response).rejects.toThrow('upload failed');
    expect(dispatchSpy.steps).toEqual(['insertAccepted', 'renderPdf', 'uploadRenderedPdf']);
    expect(dispatchSpy.publishInputs).toEqual([]);
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
  createCommandEventId?: () => string;
  dispatchSpy?: DispatchSpy;
  renderedPdfBucket?: string;
  renderPdf?: CreatePrintJobDependencies['renderPdf'];
  uploadRenderedPdf?: CreatePrintJobDependencies['uploadRenderedPdf'];
  createRenderedPdfDownloadUrl?: CreatePrintJobDependencies['createRenderedPdfDownloadUrl'];
  commandPublisher?: CreatePrintJobDependencies['commandPublisher'];
}): CreatePrintJobDependencies {
  const renderPdf =
    overrides.renderPdf ??
    (async (input) => {
      overrides.dispatchSpy?.steps.push('renderPdf');
      overrides.dispatchSpy?.renderInputs.push(input);
      return {
        contentType: 'application/pdf',
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      };
    });
  const uploadRenderedPdf =
    overrides.uploadRenderedPdf ??
    (async (input) => {
      overrides.dispatchSpy?.steps.push('uploadRenderedPdf');
      overrides.dispatchSpy?.uploadInputs.push(input);
      return {
        bucket: input.bucket,
        key: `rendered-pdfs/jobs/${input.jobId}/rendered.pdf`,
        contentType: input.contentType,
        contentLength: input.pdf.byteLength,
        checksumSha256: 'checksum-123',
        uploadedAt: '2026-02-20T20:00:01.000Z',
      };
    });
  const createRenderedPdfDownloadUrl =
    overrides.createRenderedPdfDownloadUrl ??
    (async (input) => {
      overrides.dispatchSpy?.steps.push('createRenderedPdfDownloadUrl');
      overrides.dispatchSpy?.downloadUrlInputs.push(input);
      return {
        url: `https://objects.example.com/signed/${input.jobId}?sig=abc`,
        expiresAt: '2026-02-20T20:02:00.000Z',
        ttlSeconds: 120,
      };
    });
  const commandPublisher =
    overrides.commandPublisher ??
    ({
      async publish(input) {
        overrides.dispatchSpy?.steps.push('publishPrintJobCommand');
        overrides.dispatchSpy?.publishInputs.push(input);
      },
    } satisfies CreatePrintJobDependencies['commandPublisher']);

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
    renderedPdfBucket: overrides.renderedPdfBucket ?? 'rendered-pdfs',
    renderPdf,
    uploadRenderedPdf,
    createRenderedPdfDownloadUrl,
    commandPublisher,
    now: () => new Date('2026-02-20T20:00:00.000Z'),
    createJobId: overrides.createJobId,
    createEventId: overrides.createEventId,
    createCommandEventId: overrides.createCommandEventId,
  };
}

type DispatchSpy = {
  steps: string[];
  renderInputs: Array<{
    templateId: string;
    templateVersion: string;
    payload: Record<string, unknown>;
  }>;
  uploadInputs: Array<{
    jobId: string;
    printerId: string;
    templateId: string;
    templateVersion: string;
    bucket: string;
    pdf: Uint8Array;
    contentType: string;
  }>;
  downloadUrlInputs: Array<{
    jobId: string;
    renderedPdf: {
      bucket: string;
      key: string;
    };
  }>;
  publishInputs: Array<{
    topic: string;
    qos: 1;
    payload: {
      schemaVersion: string;
      type: 'print_job_dispatch';
      eventId: string;
      traceId: string;
      jobId: string;
      printerId: string;
      objectUrl: string;
      issuedAt: string;
    };
  }>;
};

function createDispatchSpy(): DispatchSpy {
  return {
    steps: [],
    renderInputs: [],
    uploadInputs: [],
    downloadUrlInputs: [],
    publishInputs: [],
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
  onInsertAccepted?: () => void;

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

    this.onInsertAccepted?.();
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
