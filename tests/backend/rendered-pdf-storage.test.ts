import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildRenderedPdfObjectKey,
  uploadRenderedPdfAndPersistMetadata,
  type RenderedPdfMetadataStore,
  type RenderedPdfObjectStorage,
} from '../../backend/src/print-jobs/rendered-pdf-storage.ts';

describe('rendered-pdf-storage', () => {
  it('builds deterministic object keys that include job identifiers', () => {
    const key = buildRenderedPdfObjectKey({
      jobId: 'job-123',
      printerId: 'printer-1',
      templateId: 'label-default',
      templateVersion: 'v2',
    });

    expect(key).toBe(
      'rendered-pdfs/jobs/job-123/printers/printer-1/templates/label-default/versions/v2/rendered.pdf'
    );
  });

  it('uploads private objects by default and persists object metadata for the job', async () => {
    const storage = new FakeObjectStorage();
    const metadataStore = new FakeMetadataStore();
    const pdf = Buffer.from('%PDF-1.7\nrendered-label');

    const result = await uploadRenderedPdfAndPersistMetadata(
      {
        jobId: 'job-456',
        printerId: 'printer-2',
        templateId: 'label-expiration',
        bucket: 'leftover-label-printer',
        pdf,
      },
      {
        objectStorage: storage,
        metadataStore,
        now: () => new Date('2026-03-10T16:00:00.000Z'),
      }
    );

    expect(storage.putRequests).toHaveLength(1);
    expect(storage.putRequests[0]).toMatchObject({
      acl: 'private',
      bucket: 'leftover-label-printer',
      key: 'rendered-pdfs/jobs/job-456/printers/printer-2/templates/label-expiration/rendered.pdf',
      contentType: 'application/pdf',
      contentLength: pdf.byteLength,
      checksumSha256: createHash('sha256').update(pdf).digest('hex'),
      metadata: {
        jobId: 'job-456',
        printerId: 'printer-2',
        templateId: 'label-expiration',
      },
    });

    expect(metadataStore.saved).toEqual([
      {
        jobId: 'job-456',
        metadata: {
          bucket: 'leftover-label-printer',
          key: 'rendered-pdfs/jobs/job-456/printers/printer-2/templates/label-expiration/rendered.pdf',
          contentType: 'application/pdf',
          contentLength: pdf.byteLength,
          checksumSha256: createHash('sha256').update(pdf).digest('hex'),
          uploadedAt: '2026-03-10T16:00:00.000Z',
          eTag: '"etag-123"',
        },
      },
    ]);

    expect(result).toEqual(metadataStore.saved[0].metadata);
  });
});

class FakeObjectStorage implements RenderedPdfObjectStorage {
  readonly putRequests: Array<{
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    metadata: Record<string, string>;
    acl: 'private' | 'public-read';
  }> = [];

  async putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    metadata: Record<string, string>;
    acl: 'private' | 'public-read';
  }): Promise<{ eTag?: string }> {
    this.putRequests.push(input);
    return { eTag: '"etag-123"' };
  }
}

class FakeMetadataStore implements RenderedPdfMetadataStore {
  readonly saved: Array<{
    jobId: string;
    metadata: {
      bucket: string;
      key: string;
      contentType: string;
      contentLength: number;
      checksumSha256: string;
      uploadedAt: string;
      eTag?: string;
    };
  }> = [];

  async saveRenderedPdfMetadata(
    jobId: string,
    metadata: {
      bucket: string;
      key: string;
      contentType: string;
      contentLength: number;
      checksumSha256: string;
      uploadedAt: string;
      eTag?: string;
    }
  ): Promise<void> {
    this.saved.push({ jobId, metadata });
  }
}
