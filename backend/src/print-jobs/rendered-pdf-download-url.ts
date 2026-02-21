import { z } from 'zod';

import type { RenderedPdfMetadataDocument } from '../data/schema-contracts.ts';

const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 120;
const MAX_DOWNLOAD_URL_TTL_SECONDS = 900;

const createRenderedPdfDownloadUrlInputSchema = z.object({
  jobId: z.string().trim().min(1),
  renderedPdf: z.object({
    bucket: z.string().trim().min(1),
    key: z.string().trim().min(1),
  }),
  ttlSeconds: z.number().optional(),
});

const signerResponseSchema = z.object({
  url: z.string().trim().min(1),
  expiresAt: isoTimestampSchema('signerResponse.expiresAt').optional(),
});

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
  const parsedInput = createRenderedPdfDownloadUrlInputSchema.parse(input);
  const ttlSeconds = resolveTtlSeconds(parsedInput.ttlSeconds, deps.defaultTtlSeconds);
  const now = deps.now?.() ?? new Date();

  try {
    const signed = signerResponseSchema.parse(
      await deps.signer.createPresignedGetObjectUrl({
        bucket: parsedInput.renderedPdf.bucket,
        key: parsedInput.renderedPdf.key,
        expiresInSeconds: ttlSeconds,
      })
    );
    const fallbackExpiry = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
    const expiresAt = signed.expiresAt ?? fallbackExpiry;
    const expiryEpochMs = Date.parse(expiresAt);

    if (Number.isFinite(expiryEpochMs) && expiryEpochMs <= now.getTime()) {
      deps.onLog?.({
        event: 'rendered_pdf_download_url',
        result: 'expired',
        jobId: parsedInput.jobId,
        bucket: parsedInput.renderedPdf.bucket,
        key: parsedInput.renderedPdf.key,
        ttlSeconds,
        expiresAt,
      });
      throw new ExpiredRenderedPdfDownloadUrlError(expiresAt);
    }

    deps.onLog?.({
      event: 'rendered_pdf_download_url',
      result: 'generated',
      jobId: parsedInput.jobId,
      bucket: parsedInput.renderedPdf.bucket,
      key: parsedInput.renderedPdf.key,
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
      jobId: parsedInput.jobId,
      bucket: parsedInput.renderedPdf.bucket,
      key: parsedInput.renderedPdf.key,
      ttlSeconds,
      reason: toErrorReason(error),
    });

    throw error;
  }
}

function resolveTtlSeconds(inputTtlSeconds: number | undefined, defaultTtlSeconds: number | undefined): number {
  const ttlSeconds = inputTtlSeconds ?? defaultTtlSeconds ?? DEFAULT_DOWNLOAD_URL_TTL_SECONDS;
  return z
    .number()
    .refine((value) => Number.isInteger(value), {
      message: 'presigned URL TTL must be an integer number of seconds',
    })
    .refine((value) => value > 0, {
      message: 'presigned URL TTL must be greater than zero seconds',
    })
    .refine((value) => value <= MAX_DOWNLOAD_URL_TTL_SECONDS, {
      message: `presigned URL TTL must be <= ${MAX_DOWNLOAD_URL_TTL_SECONDS} seconds`,
    })
    .parse(ttlSeconds);
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown_error';
}

function isoTimestampSchema(fieldName: string): z.ZodType<string> {
  return z.string().trim().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
    message: `${fieldName} must be an ISO-8601 timestamp`,
  });
}
