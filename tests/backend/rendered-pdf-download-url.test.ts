import { describe, expect, it } from 'vitest';

import {
  createRenderedPdfDownloadUrl,
  ExpiredRenderedPdfDownloadUrlError,
  type RenderedPdfDownloadUrlLog,
  type RenderedPdfDownloadUrlSigner,
} from '../../backend/src/print-jobs/rendered-pdf-download-url.ts';

describe('rendered-pdf-download-url', () => {
  it('generates a read-only, single-object presigned URL with configurable TTL', async () => {
    const signer = new FakeDownloadUrlSigner({
      url: 'https://objects.example.com/signed/job-123?sig=abc',
      expiresAt: '2026-03-10T16:02:00.000Z',
    });
    const logs: RenderedPdfDownloadUrlLog[] = [];

    const result = await createRenderedPdfDownloadUrl(
      {
        jobId: 'job-123',
        renderedPdf: {
          bucket: 'leftover-label-printer',
          key: 'rendered-pdfs/jobs/job-123/printers/printer-1/templates/label-default/rendered.pdf',
        },
        ttlSeconds: 90,
      },
      {
        signer,
        now: () => new Date('2026-03-10T16:00:00.000Z'),
        onLog: (entry) => logs.push(entry),
      }
    );

    expect(signer.requests).toEqual([
      {
        bucket: 'leftover-label-printer',
        key: 'rendered-pdfs/jobs/job-123/printers/printer-1/templates/label-default/rendered.pdf',
        expiresInSeconds: 90,
      },
    ]);
    expect(result).toEqual({
      url: 'https://objects.example.com/signed/job-123?sig=abc',
      expiresAt: '2026-03-10T16:02:00.000Z',
      ttlSeconds: 90,
    });
    expect(logs).toEqual([
      {
        event: 'rendered_pdf_download_url',
        result: 'generated',
        jobId: 'job-123',
        bucket: 'leftover-label-printer',
        key: 'rendered-pdfs/jobs/job-123/printers/printer-1/templates/label-default/rendered.pdf',
        ttlSeconds: 90,
        expiresAt: '2026-03-10T16:02:00.000Z',
      },
    ]);
  });

  it('uses a short default TTL when one is not specified', async () => {
    const signer = new FakeDownloadUrlSigner({
      url: 'https://objects.example.com/signed/job-default?sig=abc',
    });

    const result = await createRenderedPdfDownloadUrl(
      {
        jobId: 'job-default',
        renderedPdf: {
          bucket: 'leftover-label-printer',
          key: 'rendered-pdfs/jobs/job-default/printers/printer-1/templates/label-default/rendered.pdf',
        },
      },
      {
        signer,
        now: () => new Date('2026-03-10T16:00:00.000Z'),
      }
    );

    expect(signer.requests[0]?.expiresInSeconds).toBe(120);
    expect(result.expiresAt).toBe('2026-03-10T16:02:00.000Z');
  });

  it('handles and logs already-expired URLs', async () => {
    const signer = new FakeDownloadUrlSigner({
      url: 'https://objects.example.com/signed/job-expired?sig=abc',
      expiresAt: '2026-03-10T15:59:30.000Z',
    });
    const logs: RenderedPdfDownloadUrlLog[] = [];

    await expect(() =>
      createRenderedPdfDownloadUrl(
        {
          jobId: 'job-expired',
          renderedPdf: {
            bucket: 'leftover-label-printer',
            key: 'rendered-pdfs/jobs/job-expired/printers/printer-1/templates/label-default/rendered.pdf',
          },
          ttlSeconds: 60,
        },
        {
          signer,
          now: () => new Date('2026-03-10T16:00:00.000Z'),
          onLog: (entry) => logs.push(entry),
        }
      )
    ).rejects.toBeInstanceOf(ExpiredRenderedPdfDownloadUrlError);

    expect(logs).toEqual([
      {
        event: 'rendered_pdf_download_url',
        result: 'expired',
        jobId: 'job-expired',
        bucket: 'leftover-label-printer',
        key: 'rendered-pdfs/jobs/job-expired/printers/printer-1/templates/label-default/rendered.pdf',
        ttlSeconds: 60,
        expiresAt: '2026-03-10T15:59:30.000Z',
      },
    ]);
  });

  it('rejects invalid TTL values before requesting a presigned URL', async () => {
    const signer = new FakeDownloadUrlSigner({
      url: 'https://objects.example.com/signed/job-invalid-ttl?sig=abc',
    });

    await expect(() =>
      createRenderedPdfDownloadUrl(
        {
          jobId: 'job-invalid-ttl',
          renderedPdf: {
            bucket: 'leftover-label-printer',
            key: 'rendered-pdfs/jobs/job-invalid-ttl/printers/printer-1/templates/label-default/rendered.pdf',
          },
          ttlSeconds: 1.5,
        },
        {
          signer,
        }
      )
    ).rejects.toThrow('presigned URL TTL must be an integer number of seconds');

    expect(signer.requests).toHaveLength(0);
  });

  it('logs and rethrows signer errors during URL generation', async () => {
    const signer = new FakeDownloadUrlSigner({
      error: new Error('storage signer unavailable'),
    });
    const logs: RenderedPdfDownloadUrlLog[] = [];

    await expect(() =>
      createRenderedPdfDownloadUrl(
        {
          jobId: 'job-failure',
          renderedPdf: {
            bucket: 'leftover-label-printer',
            key: 'rendered-pdfs/jobs/job-failure/printers/printer-1/templates/label-default/rendered.pdf',
          },
          ttlSeconds: 75,
        },
        {
          signer,
          onLog: (entry) => logs.push(entry),
        }
      )
    ).rejects.toThrow('storage signer unavailable');

    expect(logs).toEqual([
      {
        event: 'rendered_pdf_download_url',
        result: 'generation_failed',
        jobId: 'job-failure',
        bucket: 'leftover-label-printer',
        key: 'rendered-pdfs/jobs/job-failure/printers/printer-1/templates/label-default/rendered.pdf',
        ttlSeconds: 75,
        reason: 'storage signer unavailable',
      },
    ]);
  });
});

class FakeDownloadUrlSigner implements RenderedPdfDownloadUrlSigner {
  readonly requests: Array<{
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }> = [];

  private readonly response:
    | {
        url: string;
        expiresAt?: string;
      }
    | {
        error: Error;
      };

  constructor(
    response:
      | {
          url: string;
          expiresAt?: string;
        }
      | {
          error: Error;
        }
  ) {
    this.response = response;
  }

  async createPresignedGetObjectUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt?: string }> {
    this.requests.push(input);

    if ('error' in this.response) {
      throw this.response.error;
    }

    return this.response;
  }
}
