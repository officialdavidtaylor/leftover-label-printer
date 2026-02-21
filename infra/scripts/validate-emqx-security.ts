#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

type EnvMap = Record<string, string>;

function parseEnvFile(envText: string): EnvMap {
  const env: EnvMap = {};

  for (const rawLine of envText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);

    if (key !== '') {
      env[key] = value;
    }
  }

  return env;
}

function main(argv: string[]): void {
  const envFile = argv[0] ?? '.env';
  const envPath = path.resolve(process.cwd(), envFile);

  if (!fs.existsSync(envPath)) {
    throw new Error(`infra security: env file not found: ${envFile}`);
  }

  const env = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  const deploymentEnv = env.EMQX_DEPLOYMENT_ENV ?? 'local';
  const requireTls = env.EMQX_REQUIRE_TLS ?? 'false';
  const enablePlainMqtt = env.EMQX_ENABLE_PLAIN_MQTT ?? 'true';

  if (deploymentEnv !== 'local') {
    if (requireTls !== 'true') {
      throw new Error(
        `infra security: EMQX_REQUIRE_TLS must be true when EMQX_DEPLOYMENT_ENV is ${deploymentEnv}.`
      );
    }

    if (enablePlainMqtt !== 'false') {
      throw new Error(
        `infra security: EMQX_ENABLE_PLAIN_MQTT must be false when EMQX_DEPLOYMENT_ENV is ${deploymentEnv}.`
      );
    }
  }

  if (requireTls === 'true') {
    const certDir = env.EMQX_TLS_CERT_DIR ?? './emqx/certs';
    const caFile = env.EMQX_TLS_CA_CERT_FILE ?? 'ca.crt';
    const certFile = env.EMQX_TLS_CERT_FILE ?? 'server.crt';
    const keyFile = env.EMQX_TLS_KEY_FILE ?? 'server.key';

    for (const fileName of [caFile, certFile, keyFile]) {
      const filePath = path.resolve(process.cwd(), certDir, fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`infra security: missing TLS file: ${certDir}/${fileName}`);
      }
    }
  }

  process.stdout.write(`infra security: EMQX TLS/auth guardrails passed for ${deploymentEnv}.\n`);
}

try {
  main(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
