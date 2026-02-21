import type { RenderedPdfMetadataDocument } from '../data/schema-contracts.ts';

const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 120;
const MAX_DOWNLOAD_URL_TTL_SECONDS = 900;

export type CreateRenderedPdfDownloadUrlInput = {
  jobId: string;
  renderedPdf: Pick<RenderedPdfMetadataDocument, 'bucket' | 'key'>;
  ttlSeconds?: number;
};

export type RenderedPdfDownloadUrl = {
  url: string;
  expiresAt: string;
  ttlSeconds: number;
};

export interface RenderedPdfDownloadUrlSigner {
  createPresignedGetObjectUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    expiresAt?: string;
  }>;
}

export type RenderedPdfDownloadUrlLog = {
  event: 'rendered_pdf_download_url';
  result: 'generated' | 'expired' | 'generation_failed';
  jobId: string;
  bucket: string;
  key: string;
  ttlSeconds: number;
  expiresAt?: string;
  reason?: string;
};

type CreateRenderedPdfDownloadUrlDependencies = {
  signer: RenderedPdfDownloadUrlSigner;
  defaultTtlSeconds?: number;
  now?: () => Date;
  onLog?: (entry: RenderedPdfDownloadUrlLog) => void;
};

export class ExpiredRenderedPdfDownloadUrlError extends Error {
  readonly expiresAt: string;

  constructor(expiresAt: string) {
    super('Rendered PDF presigned URL is already expired');
    this.name = 'ExpiredRenderedPdfDownloadUrlError';
    this.expiresAt = expiresAt;
  }
}

export async function createRenderedPdfDownloadUrl(
  input: CreateRenderedPdfDownloadUrlInput,
  deps: CreateRenderedPdfDownloadUrlDependencies
): Promise<RenderedPdfDownloadUrl> {
  assertNonEmpty(input.jobId, 'jobId');
  assertNonEmpty(input.renderedPdf.bucket, 'renderedPdf.bucket');
  assertNonEmpty(input.renderedPdf.key, 'renderedPdf.key');

  const ttlSeconds = resolveTtlSeconds(input.ttlSeconds, deps.defaultTtlSeconds);
  const now = deps.now?.() ?? new Date();

  try {
    const signed = await deps.signer.createPresignedGetObjectUrl({
      bucket: input.renderedPdf.bucket,
      key: input.renderedPdf.key,
      expiresInSeconds: ttlSeconds,
    });

    const fallbackExpiry = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
    const expiresAt = signed.expiresAt ?? fallbackExpiry;
    const expiryEpochMs = Date.parse(expiresAt);

    if (Number.isFinite(expiryEpochMs) && expiryEpochMs <= now.getTime()) {
      deps.onLog?.({
        event: 'rendered_pdf_download_url',
        result: 'expired',
        jobId: input.jobId,
        bucket: input.renderedPdf.bucket,
        key: input.renderedPdf.key,
        ttlSeconds,
        expiresAt,
      });
      throw new ExpiredRenderedPdfDownloadUrlError(expiresAt);
    }

    deps.onLog?.({
      event: 'rendered_pdf_download_url',
      result: 'generated',
      jobId: input.jobId,
      bucket: input.renderedPdf.bucket,
      key: input.renderedPdf.key,
      ttlSeconds,
      expiresAt,
    });

    return {
      url: signed.url,
      expiresAt,
      ttlSeconds,
    };
  } catch (error) {
    if (error instanceof ExpiredRenderedPdfDownloadUrlError) {
      throw error;
    }

    deps.onLog?.({
      event: 'rendered_pdf_download_url',
      result: 'generation_failed',
      jobId: input.jobId,
      bucket: input.renderedPdf.bucket,
      key: input.renderedPdf.key,
      ttlSeconds,
      reason: toErrorReason(error),
    });

    throw error;
  }
}

function resolveTtlSeconds(inputTtlSeconds: number | undefined, defaultTtlSeconds: number | undefined): number {
  const ttlSeconds = inputTtlSeconds ?? defaultTtlSeconds ?? DEFAULT_DOWNLOAD_URL_TTL_SECONDS;

  if (!Number.isInteger(ttlSeconds)) {
    throw new Error('presigned URL TTL must be an integer number of seconds');
  }

  if (ttlSeconds <= 0) {
    throw new Error('presigned URL TTL must be greater than zero seconds');
  }

  if (ttlSeconds > MAX_DOWNLOAD_URL_TTL_SECONDS) {
    throw new Error(`presigned URL TTL must be <= ${MAX_DOWNLOAD_URL_TTL_SECONDS} seconds`);
  }

  return ttlSeconds;
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown_error';
}
