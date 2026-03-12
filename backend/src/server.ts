import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { OidcJwtVerifier } from './auth/jwt-verifier.ts';
import { handleCreatePrintJob } from './api/create-print-job.ts';
import { handleGetPrintJobStatus } from './api/get-print-job-status.ts';
import { createRenderedPdfDownloadUrl } from './print-jobs/rendered-pdf-download-url.ts';
import { uploadRenderedPdfAndPersistMetadata } from './print-jobs/rendered-pdf-storage.ts';
import { renderPdfTemplate } from './rendering/pdf-renderer.ts';
import { loadBackendRuntimeConfig } from './runtime/config.ts';
import {
  connectMongoClient,
  ensureCriticalIndexes,
  getBackendCollections,
  MongoBackendStore,
  seedDemoData,
} from './runtime/mongo-store.ts';
import {
  closeMqttClient,
  connectMqttClient,
  MqttPrintJobCommandPublisher,
} from './runtime/mqtt-command-publisher.ts';
import { createS3Client, S3RenderedPdfDownloadUrlSigner, S3RenderedPdfObjectStorage } from './runtime/s3-storage.ts';

const config = loadBackendRuntimeConfig();

const mongoClient = await connectMongoClient(config.mongoUri);
const collections = getBackendCollections(mongoClient, config.mongoDbName);
await ensureCriticalIndexes(collections);

if (config.bootstrapDemoData) {
  await seedDemoData(collections, {
    printerId: config.bootstrapPrinterId,
    nodeId: config.bootstrapPrinterNodeId,
    location: config.bootstrapPrinterLocation,
    templateId: config.bootstrapTemplateId,
    templateVersion: config.bootstrapTemplateVersion,
    now: new Date(),
  });
}

const store = new MongoBackendStore(collections);
const s3Client = createS3Client({
  endpoint: config.s3Endpoint,
  region: config.s3Region,
  accessKeyId: config.s3AccessKeyId,
  secretAccessKey: config.s3SecretAccessKey,
});
const mqttClient = await connectMqttClient({
  brokerUrl: config.mqttBrokerUrl,
  username: config.mqttUsername,
  password: config.mqttPassword,
});

const objectStorage = new S3RenderedPdfObjectStorage(s3Client);
const urlSigner = new S3RenderedPdfDownloadUrlSigner(s3Client);
const commandPublisher = new MqttPrintJobCommandPublisher(mqttClient);
const authVerifier = new OidcJwtVerifier({
  issuerUrl: config.oidcIssuerUrl,
  audience: config.oidcAudience,
  rolesClaim: config.oidcRolesClaim,
  discoveryUrl: new URL('.well-known/openid-configuration', config.oidcIssuerUrl).toString(),
});

const server = createServer(async (request, response) => {
  const traceId = readTraceId(request);

  try {
    await routeRequest(request, response, traceId);
  } catch (error) {
    log('error', 'backend_request_failed', {
      traceId,
      method: request.method ?? 'UNKNOWN',
      path: request.url ?? '/',
      error: toErrorMessage(error),
    });
    sendJson(response, 500, traceId, {
      code: 'internal_error',
      message: 'Internal server error',
      traceId,
    });
  }
});

server.listen(config.port, () => {
  log('info', 'backend_server_started', {
    port: config.port,
    mongoDbName: config.mongoDbName,
    bootstrapDemoData: config.bootstrapDemoData,
    bootstrapPrinterId: config.bootstrapPrinterId,
    bootstrapTemplateId: config.bootstrapTemplateId,
  });
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  traceId: string
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, traceId, {
      status: 'ok',
      traceId,
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/v1/print-jobs') {
    const body = await readJsonBody(request);
    const result = await handleCreatePrintJob(
      {
        authorizationHeader: request.headers.authorization,
        traceId,
        body,
      },
      {
        authVerifier,
        store,
        renderedPdfBucket: config.s3Bucket,
        renderPdf: async (input) => {
          const rendered = renderPdfTemplate(input);
          return {
            contentType: rendered.contentType,
            pdfBytes: rendered.pdfBytes,
          };
        },
        uploadRenderedPdf: async (input) =>
          uploadRenderedPdfAndPersistMetadata(input, {
            objectStorage,
            metadataStore: store,
          }),
        createRenderedPdfDownloadUrl: async (input) =>
          createRenderedPdfDownloadUrl(input, {
            signer: urlSigner,
          }),
        commandPublisher,
        onLog: (entry) => log(entry.result === 'accepted' ? 'info' : 'warn', entry.event, entry),
      }
    );

    sendJson(response, result.status, traceId, result.body);
    return;
  }

  const jobIdMatch = url.pathname.match(/^\/v1\/print-jobs\/([^/]+)$/);
  if (method === 'GET' && jobIdMatch) {
    const result = await handleGetPrintJobStatus(
      {
        authorizationHeader: request.headers.authorization,
        traceId,
        jobId: decodeURIComponent(jobIdMatch[1] ?? ''),
      },
      {
        authVerifier,
        store,
        onLog: (entry) => log(entry.result === 'ok' ? 'info' : 'warn', entry.event, entry),
      }
    );

    sendJson(response, result.status, traceId, result.body);
    return;
  }

  sendJson(response, 404, traceId, {
    code: 'not_found',
    message: 'Not found',
    traceId,
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > 1_048_576) {
      throw new Error('request body too large');
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function readTraceId(request: IncomingMessage): string {
  const header = request.headers['x-trace-id'];
  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }

  return randomUUID();
}

function sendJson(
  response: ServerResponse<IncomingMessage>,
  status: number,
  traceId: string,
  body: Record<string, unknown>
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('x-trace-id', traceId);
  response.end(JSON.stringify(body));
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
  const entry = {
    level,
    event,
    ...fields,
  };

  console.log(JSON.stringify(entry));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown_error';
}

async function shutdown(): Promise<void> {
  log('info', 'backend_server_shutdown_started', {});
  server.close();
  await closeMqttClient(mqttClient);
  await mongoClient.close();
  process.exit(0);
}
