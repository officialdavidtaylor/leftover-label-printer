import {
  MongoClient,
  MongoServerError,
  type ClientSession,
  type Collection,
  type Document,
  type MongoClientOptions,
} from 'mongodb';
import { z } from 'zod';

import type {
  CreatePrintJobStore,
  PersistedPrintJob,
} from '../api/create-print-job.ts';
import type {
  GetPrintJobStatusStore,
  PersistedPrintJobForStatus,
} from '../api/get-print-job-status.ts';
import {
  CRITICAL_INDEX_CONTRACTS,
  type CollectionIndexContract,
} from '../data/index-contracts.ts';
import {
  jobEventDocumentSchema,
  printerDocumentSchema,
  printJobDocumentSchema,
  renderedPdfMetadataSchema,
  templateDocumentSchema,
  type JobEventDocument,
  type PrinterDocument,
  type RenderedPdfMetadataDocument,
  type TemplateDocument,
} from '../data/schema-contracts.ts';
import { DuplicateIdempotencyKeyError } from '../print-jobs/idempotent-submission.ts';
import type { RenderedPdfMetadataStore } from '../print-jobs/rendered-pdf-storage.ts';

const persistedPrintJobDocumentSchema = printJobDocumentSchema.extend({
  ownerUserId: z.string().trim().min(1),
});

type PersistedPrintJobDocument = z.infer<typeof persistedPrintJobDocumentSchema>;

export type BackendCollections = {
  printJobs: Collection<PersistedPrintJobDocument>;
  jobEvents: Collection<JobEventDocument>;
  printers: Collection<PrinterDocument>;
  templates: Collection<TemplateDocument>;
};

export async function connectMongoClient(uri: string, options: MongoClientOptions = {}): Promise<MongoClient> {
  const client = new MongoClient(uri, options);
  await client.connect();
  return client;
}

export function getBackendCollections(client: MongoClient, dbName: string): BackendCollections {
  const db = client.db(dbName);
  return {
    printJobs: db.collection<PersistedPrintJobDocument>('print_jobs'),
    jobEvents: db.collection<JobEventDocument>('job_events'),
    printers: db.collection<PrinterDocument>('printers'),
    templates: db.collection<TemplateDocument>('templates'),
  };
}

export async function ensureCriticalIndexes(collections: BackendCollections): Promise<void> {
  for (const contract of CRITICAL_INDEX_CONTRACTS) {
    const collection = resolveCollection(contract, collections);
    await collection.createIndex(contract.key, {
      name: contract.name,
      ...(contract.unique !== undefined ? { unique: contract.unique } : {}),
      ...(contract.sparse !== undefined ? { sparse: contract.sparse } : {}),
    });
  }
}

export async function seedDemoData(
  collections: BackendCollections,
  input: {
    printerId: string;
    nodeId: string;
    location: string;
    templateId: string;
    templateVersion: string;
    now: Date;
  }
): Promise<void> {
  const nowIso = input.now.toISOString();

  const printer = printerDocumentSchema.parse({
    printerId: input.printerId,
    nodeId: input.nodeId,
    status: 'online',
    capabilities: {
      model: 'Dymo LabelWriter 450',
      media: ['1x2.125'],
    },
    metadata: {
      location: input.location,
    },
    lastSeenAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  const { createdAt: printerCreatedAt, ...printerUpsertFields } = printer;

  await collections.printers.updateOne(
    { printerId: input.printerId },
    {
      $set: {
        ...printerUpsertFields,
        updatedAt: nowIso,
        lastSeenAt: nowIso,
      },
      $setOnInsert: {
        createdAt: printerCreatedAt,
      },
    },
    { upsert: true }
  );

  const template = templateDocumentSchema.parse({
    templateId: input.templateId,
    version: input.templateVersion,
    name: 'Default Leftover Label',
    schemaVersion: '1.0.0',
    renderEngine: 'minimal-pdf',
    status: 'active',
    config: {
      pageSize: '1x2.125',
      locale: 'en-US',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  const { createdAt: templateCreatedAt, ...templateUpsertFields } = template;

  await collections.templates.updateOne(
    { templateId: input.templateId, version: input.templateVersion },
    {
      $set: {
        ...templateUpsertFields,
        updatedAt: nowIso,
      },
      $setOnInsert: {
        createdAt: templateCreatedAt,
      },
    },
    { upsert: true }
  );
}

export class MongoBackendStore implements CreatePrintJobStore, GetPrintJobStatusStore, RenderedPdfMetadataStore {
  private readonly collections: BackendCollections;

  constructor(collections: BackendCollections) {
    this.collections = collections;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<PersistedPrintJob | null> {
    const document = await this.collections.printJobs.findOne({ idempotencyKey });
    return document ? toPersistedPrintJob(document) : null;
  }

  async insertAccepted(data: { job: PersistedPrintJob; event: JobEventDocument }): Promise<void> {
    const job = persistedPrintJobDocumentSchema.parse(data.job);
    const event = jobEventDocumentSchema.parse(data.event);

    try {
      await this.withLifecycleTransaction(async (session) => {
        await this.collections.printJobs.insertOne(job, { session });
        await this.collections.jobEvents.insertOne(event, { session });
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new DuplicateIdempotencyKeyError(job.idempotencyKey);
      }

      throw error;
    }
  }

  async printerExists(printerId: string): Promise<boolean> {
    const count = await this.collections.printers.countDocuments({ printerId }, { limit: 1 });
    return count > 0;
  }

  async templateExists(templateId: string, templateVersion?: string): Promise<boolean> {
    const count = await this.collections.templates.countDocuments(
      {
        templateId,
        ...(templateVersion ? { version: templateVersion } : {}),
        status: 'active',
      },
      { limit: 1 }
    );
    return count > 0;
  }

  async appendEventAndSetState(data: {
    jobId: string;
    nextState: PersistedPrintJob['state'];
    event: JobEventDocument;
  }): Promise<void> {
    const event = jobEventDocumentSchema.parse(data.event);
    await this.withLifecycleTransaction(async (session) => {
      const updateResult = await this.collections.printJobs.updateOne(
        { jobId: data.jobId },
        {
          $set: {
            state: data.nextState,
            updatedAt: event.occurredAt,
          },
        },
        { session }
      );

      if (updateResult.matchedCount !== 1) {
        throw new Error(`job not found: ${data.jobId}`);
      }

      await this.collections.jobEvents.insertOne(event, { session });
    });
  }

  async findByJobId(jobId: string): Promise<PersistedPrintJobForStatus | null> {
    const document = await this.collections.printJobs.findOne({ jobId });
    if (!document) {
      return null;
    }

    const parsed = persistedPrintJobDocumentSchema.parse(document);
    return {
      jobId: parsed.jobId,
      ownerUserId: parsed.ownerUserId,
      state: parsed.state,
      printerId: parsed.printerId,
      templateId: parsed.templateId,
      ...(parsed.templateVersion ? { templateVersion: parsed.templateVersion } : {}),
    };
  }

  async listEventsForJob(jobId: string): Promise<JobEventDocument[]> {
    const events = await this.collections.jobEvents.find({ jobId }).sort({ occurredAt: 1, eventId: 1 }).toArray();
    return events.map((event) => jobEventDocumentSchema.parse(event));
  }

  async saveRenderedPdfMetadata(jobId: string, metadata: RenderedPdfMetadataDocument): Promise<void> {
    const renderedPdf = renderedPdfMetadataSchema.parse(metadata);
    await this.collections.printJobs.updateOne(
      { jobId },
      {
        $set: {
          renderedPdf,
          updatedAt: renderedPdf.uploadedAt,
        },
      }
    );
  }

  private async withLifecycleTransaction<T>(operation: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.collections.printJobs.db.client.startSession();

    try {
      return await session.withTransaction(async () => operation(session));
    } finally {
      await session.endSession();
    }
  }
}

function resolveCollection(
  contract: CollectionIndexContract,
  collections: BackendCollections
): Collection<Document> {
  return (contract.collection === 'print_jobs' ? collections.printJobs : collections.jobEvents) as unknown as Collection<Document>;
}

function toPersistedPrintJob(document: PersistedPrintJobDocument): PersistedPrintJob {
  const parsed = persistedPrintJobDocumentSchema.parse(document);
  return {
    jobId: parsed.jobId,
    ownerUserId: parsed.ownerUserId,
    idempotencyKey: parsed.idempotencyKey,
    state: parsed.state,
    printerId: parsed.printerId,
    templateId: parsed.templateId,
    ...(parsed.templateVersion ? { templateVersion: parsed.templateVersion } : {}),
    payload: parsed.payload,
    traceId: parsed.traceId,
    acceptedAt: parsed.acceptedAt,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    ...(parsed.renderedPdf ? { renderedPdf: parsed.renderedPdf } : {}),
  };
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}
