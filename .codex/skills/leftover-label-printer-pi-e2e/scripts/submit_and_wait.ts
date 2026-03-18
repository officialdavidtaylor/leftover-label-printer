#!/usr/bin/env node

import { randomUUID } from 'node:crypto';

const USAGE = `usage: node --experimental-strip-types .codex/skills/leftover-label-printer-pi-e2e/scripts/submit_and_wait.ts \\
  --backend-base-url=<url> \\
  --token=<bearer-token> \\
  --printer-id=<printer-id> \\
  --template-id=<template-id> \\
  --template-version=<version> \\
  --timeout-seconds=<seconds> \\
  [--item-name=<label>]`;

type ParsedArgs = {
  help?: boolean;
  itemName: string;
  [key: string]: string | boolean | undefined;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    itemName: 'Pi E2E Smoke',
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith('--') || !arg.includes('=')) {
      throw new Error(`${USAGE}\nunsupported argument: ${arg}`);
    }

    const [key, ...valueParts] = arg.slice(2).split('=');
    const value = valueParts.join('=').trim();
    if (value === '') {
      throw new Error(`${USAGE}\nmissing value for --${key}`);
    }

    parsed[key] = value;
  }

  return parsed;
}

function requireString(value: string | boolean | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${USAGE}\nmissing required argument: --${label}=...`);
  }

  return value;
}

function requirePositiveInteger(value: string | boolean | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${USAGE}\n${label} must be a positive integer.`);
  }

  return parsed;
}

async function submitPrintJob(config: {
  backendBaseUrl: string;
  token: string;
  printerId: string;
  templateId: string;
  templateVersion: string;
  itemName: string;
}): Promise<{ jobId: string; backendTraceId: string }> {
  const traceId = randomUUID();
  const response = await fetch(`${config.backendBaseUrl}/v1/print-jobs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      'x-trace-id': traceId,
    },
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      printerId: config.printerId,
      templateId: config.templateId,
      templateVersion: config.templateVersion,
      payload: {
        itemName: config.itemName,
        datePrepared: new Date().toISOString().slice(0, 10),
      },
    }),
  });

  const body = await response.text();
  if (response.status !== 202) {
    throw new Error(`print job submission failed (HTTP ${response.status}).\n${body}`);
  }

  const parsed = JSON.parse(body) as { jobId?: string; traceId?: string };
  if (!parsed.jobId) {
    throw new Error('accepted response did not include jobId.');
  }

  return {
    jobId: parsed.jobId,
    backendTraceId: parsed.traceId ?? traceId,
  };
}

async function waitForTerminalState(config: {
  backendBaseUrl: string;
  token: string;
  jobId: string;
  timeoutSeconds: number;
}): Promise<{ state: string; raw: string }> {
  const deadline = Date.now() + config.timeoutSeconds * 1000;
  let lastState = 'unknown';
  let lastBody = '';

  while (Date.now() < deadline) {
    const response = await fetch(`${config.backendBaseUrl}/v1/print-jobs/${encodeURIComponent(config.jobId)}`, {
      headers: {
        authorization: `Bearer ${config.token}`,
      },
    });

    lastBody = await response.text();
    if (response.status !== 200) {
      throw new Error(`job status lookup failed (HTTP ${response.status}).\n${lastBody}`);
    }

    const parsed = JSON.parse(lastBody) as { state?: string };
    lastState = typeof parsed.state === 'string' ? parsed.state : 'unknown';
    if (lastState === 'printed' || lastState === 'failed') {
      return {
        state: lastState,
        raw: lastBody,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`timed out waiting for terminal state; last state was ${lastState}.\n${lastBody}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const config = {
    backendBaseUrl: requireString(args['backend-base-url'], 'backend-base-url').replace(/\/$/, ''),
    token: requireString(args.token, 'token'),
    printerId: requireString(args['printer-id'], 'printer-id'),
    templateId: requireString(args['template-id'], 'template-id'),
    templateVersion: requireString(args['template-version'], 'template-version'),
    timeoutSeconds: requirePositiveInteger(args['timeout-seconds'], 'timeout-seconds'),
    itemName:
      typeof args['item-name'] === 'string' && args['item-name'].trim() !== '' ? args['item-name'] : 'Pi E2E Smoke',
  };

  const accepted = await submitPrintJob(config);
  const terminal = await waitForTerminalState({
    backendBaseUrl: config.backendBaseUrl,
    token: config.token,
    jobId: accepted.jobId,
    timeoutSeconds: config.timeoutSeconds,
  });

  process.stdout.write(`jobId=${accepted.jobId}\n`);
  process.stdout.write(`terminalState=${terminal.state}\n`);
  process.stdout.write(`backendTraceId=${accepted.backendTraceId}\n`);
  process.stdout.write(`jobStatusJson=${terminal.raw}\n`);

  if (terminal.state !== 'printed') {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
