import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { RenderedPdfDownloadUrlSigner } from '../print-jobs/rendered-pdf-download-url.ts';
import type { RenderedPdfObjectStorage } from '../print-jobs/rendered-pdf-storage.ts';

export function createS3Client(config: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export class S3RenderedPdfObjectStorage implements RenderedPdfObjectStorage {
  constructor(private readonly client: S3Client) {}

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
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        ChecksumSHA256: Buffer.from(input.checksumSha256, 'hex').toString('base64'),
        Metadata: input.metadata,
        ACL: input.acl,
      })
    );

    return {
      ...(response.ETag ? { eTag: response.ETag } : {}),
    };
  }
}

export class S3RenderedPdfDownloadUrlSigner implements RenderedPdfDownloadUrlSigner {
  constructor(private readonly client: S3Client) {}

  async createPresignedGetObjectUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<{ url: string }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
      { expiresIn: input.expiresInSeconds }
    );

    return { url };
  }
}
