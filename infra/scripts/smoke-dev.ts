#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { bootstrapLocalDev, mintLocalDevAccessToken, readLocalDevConfig } from './local-dev.ts';

type SmokeOptions = {
  expectedState: 'printed' | 'failed';
  timeoutSeconds: number;
};

async function main(argv: string[]): Promise<void> {
  const { envFile, options } = parseArgs(argv);
  const config = readLocalDevConfig(envFile);

  await bootstrapLocalDev(config, (message) => process.stderr.write(`${message}\n`));
  await waitForBackend(config.backendBaseUrl, 30_000);
  const token = await mintLocalDevAccessToken(config);

  const itemName =
    options.expectedState === 'failed'
      ? `${config.mockPrintFailMarker} Local Dev Smoke`
      : 'Local Dev Smoke';
  const traceId = randomUUID();
  const createResponse = await fetch(`${config.backendBaseUrl}/v1/print-jobs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-trace-id': traceId,
    },
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      printerId: config.printerId,
      templateId: config.templateId,
      templateVersion: config.templateVersion,
      payload: {
        itemName,
        datePrepared: new Date().toISOString().slice(0, 10),
      },
    }),
  });

  const createBody = await createResponse.text();
  if (createResponse.status !== 202) {
    throw new Error(`infra smoke-dev: print job submission failed (HTTP ${createResponse.status}).\n${createBody}`);
  }

  const accepted = JSON.parse(createBody) as { jobId?: string; traceId?: string };
  if (!accepted.jobId) {
    throw new Error('infra smoke-dev: accepted response did not include jobId.');
  }

  const terminal = await waitForTerminalState({
    backendBaseUrl: config.backendBaseUrl,
    token,
    jobId: accepted.jobId,
    expectedState: options.expectedState,
    timeoutMs: options.timeoutSeconds * 1_000,
  });

  const artifactPath = path.resolve(config.artifactDir, `${accepted.jobId}.pdf`);
  const metadataPath = path.resolve(config.artifactDir, `${accepted.jobId}.json`);
  await waitForFile(artifactPath, 10_000);

  process.stdout.write(`jobId=${accepted.jobId}\n`);
  process.stdout.write(`terminalState=${terminal.state}\n`);
  process.stdout.write(`artifactPath=${artifactPath}\n`);
  if (fs.existsSync(metadataPath)) {
    process.stdout.write(`artifactMetadataPath=${metadataPath}\n`);
  }
}

function parseArgs(argv: string[]): { envFile: string; options: SmokeOptions } {
  let envFile = '.env';
  let expectedState: SmokeOptions['expectedState'] = 'printed';
  let timeoutSeconds = 60;

  for (const arg of argv) {
    if (arg.startsWith('--expected-state=')) {
      const value = arg.slice('--expected-state='.length);
      if (value === 'printed' || value === 'failed') {
        expectedState = value;
        continue;
      }

      throw new Error(`infra smoke-dev: unsupported expected state: ${value}`);
    }

    if (arg.startsWith('--timeout-seconds=')) {
      const value = Number(arg.slice('--timeout-seconds='.length));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('infra smoke-dev: --timeout-seconds must be a positive integer.');
      }

      timeoutSeconds = value;
      continue;
    }

    envFile = arg;
  }

  return {
    envFile,
    options: {
      expectedState,
      timeoutSeconds,
    },
  };
}

async function waitForBackend(backendBaseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendBaseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend is still starting.
    }

    await delay(1_000);
  }

  throw new Error(`infra smoke-dev: backend health check did not pass within ${timeoutMs / 1_000} seconds.`);
}

async function waitForTerminalState(input: {
  backendBaseUrl: string;
  token: string;
  jobId: string;
  expectedState: 'printed' | 'failed';
  timeoutMs: number;
}): Promise<{ state: 'printed' | 'failed' }> {
  const deadline = Date.now() + input.timeoutMs;
  let lastState = 'unknown';
  let lastBody = '';

  while (Date.now() < deadline) {
    const response = await fetch(`${input.backendBaseUrl}/v1/print-jobs/${encodeURIComponent(input.jobId)}`, {
      headers: {
        authorization: `Bearer ${input.token}`,
      },
    });
    lastBody = await response.text();

    if (response.status !== 200) {
      throw new Error(`infra smoke-dev: job status lookup failed (HTTP ${response.status}).\n${lastBody}`);
    }

    const parsed = JSON.parse(lastBody) as { state?: string };
    lastState = parsed.state ?? 'unknown';
    if (lastState === 'printed' || lastState === 'failed') {
      if (lastState !== input.expectedState) {
        throw new Error(
          `infra smoke-dev: expected terminal state ${input.expectedState}, received ${lastState}.\n${lastBody}`
        );
      }

      return { state: lastState };
    }

    await delay(1_000);
  }

  throw new Error(
    `infra smoke-dev: timed out waiting for terminal state ${input.expectedState}; last state was ${lastState}.\n${lastBody}`
  );
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }

    await delay(500);
  }

  throw new Error(`infra smoke-dev: expected mock artifact at ${filePath}, but it never appeared.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
