#!/usr/bin/env node

const USAGE = `usage: node --experimental-strip-types .codex/skills/leftover-label-printer-pi-e2e-playwright/scripts/wait_for_terminal.ts \\
  --backend-base-url=<url> \\
  --token=<bearer-token> \\
  --job-id=<job-id> \\
  --timeout-seconds=<seconds>`;

type ParsedArgs = {
  help?: boolean;
  [key: string]: string | boolean | undefined;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

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
    jobId: requireString(args['job-id'], 'job-id'),
    timeoutSeconds: requirePositiveInteger(args['timeout-seconds'], 'timeout-seconds'),
  };

  const terminal = await waitForTerminalState(config);

  process.stdout.write(`jobId=${config.jobId}\n`);
  process.stdout.write(`terminalState=${terminal.state}\n`);
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
