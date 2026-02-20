import { createHash } from 'node:crypto';

import type { RenderedPdfMetadataDocument } from '../data/schema-contracts.ts';

const DEFAULT_OBJECT_KEY_PREFIX = 'rendered-pdfs';
const DEFAULT_OBJECT_FILENAME = 'rendered.pdf';
const DEFAULT_PDF_CONTENT_TYPE = 'application/pdf';

export type ObjectAcl = 'private' | 'public-read';

export type UploadRenderedPdfInput = {
  jobId: string;
  printerId: string;
  templateId: string;
  templateVersion?: string;
  bucket: string;
  pdf: Uint8Array;
  contentType?: string;
};

export type UploadRenderedPdfResult = RenderedPdfMetadataDocument;

export interface RenderedPdfObjectStorage {
  putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    metadata: Record<string, string>;
    acl: ObjectAcl;
  }): Promise<{ eTag?: string }>;
}

export interface RenderedPdfMetadataStore {
  saveRenderedPdfMetadata(jobId: string, metadata: RenderedPdfMetadataDocument): Promise<void>;
}

type UploadRenderedPdfDependencies = {
  objectStorage: RenderedPdfObjectStorage;
  metadataStore: RenderedPdfMetadataStore;
  defaultObjectAcl?: ObjectAcl;
  keyPrefix?: string;
  objectFilename?: string;
  now?: () => Date;
};

export async function uploadRenderedPdfAndPersistMetadata(
  input: UploadRenderedPdfInput,
  deps: UploadRenderedPdfDependencies
): Promise<UploadRenderedPdfResult> {
  assertNonEmpty(input.jobId, 'jobId');
  assertNonEmpty(input.printerId, 'printerId');
  assertNonEmpty(input.templateId, 'templateId');
  assertNonEmpty(input.bucket, 'bucket');

  const key = buildRenderedPdfObjectKey(
    {
      jobId: input.jobId,
      printerId: input.printerId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
    },
    {
      keyPrefix: deps.keyPrefix,
      objectFilename: deps.objectFilename,
    }
  );

  const contentType = input.contentType ?? DEFAULT_PDF_CONTENT_TYPE;
  const checksumSha256 = createHash('sha256').update(input.pdf).digest('hex');
  const contentLength = input.pdf.byteLength;
  const acl = deps.defaultObjectAcl ?? 'private';

  const uploadResult = await deps.objectStorage.putObject({
    bucket: input.bucket,
    key,
    body: input.pdf,
    contentType,
    contentLength,
    checksumSha256,
    metadata: {
      jobId: input.jobId,
      printerId: input.printerId,
      templateId: input.templateId,
      ...(input.templateVersion ? { templateVersion: input.templateVersion } : {}),
    },
    acl,
  });

  const persistedMetadata: RenderedPdfMetadataDocument = {
    bucket: input.bucket,
    key,
    contentType,
    contentLength,
    checksumSha256,
    uploadedAt: (deps.now?.() ?? new Date()).toISOString(),
    ...(uploadResult.eTag ? { eTag: uploadResult.eTag } : {}),
  };

  await deps.metadataStore.saveRenderedPdfMetadata(input.jobId, persistedMetadata);

  return persistedMetadata;
}

export function buildRenderedPdfObjectKey(
  input: {
    jobId: string;
    printerId: string;
    templateId: string;
    templateVersion?: string;
  },
  options: {
    keyPrefix?: string;
    objectFilename?: string;
  } = {}
): string {
  assertNonEmpty(input.jobId, 'jobId');
  assertNonEmpty(input.printerId, 'printerId');
  assertNonEmpty(input.templateId, 'templateId');

  const keyPrefix = normalizeKeyPrefix(options.keyPrefix ?? DEFAULT_OBJECT_KEY_PREFIX);
  const objectFilename = options.objectFilename ?? DEFAULT_OBJECT_FILENAME;

  const segments = [
    keyPrefix,
    'jobs',
    encodeObjectKeySegment(input.jobId),
    'printers',
    encodeObjectKeySegment(input.printerId),
    'templates',
    encodeObjectKeySegment(input.templateId),
    ...(input.templateVersion ? ['versions', encodeObjectKeySegment(input.templateVersion)] : []),
    objectFilename,
  ];

  return segments.join('/');
}

function encodeObjectKeySegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '_');
}

function normalizeKeyPrefix(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}
