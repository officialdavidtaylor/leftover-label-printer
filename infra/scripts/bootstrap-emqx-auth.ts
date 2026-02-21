#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

type EnvMap = Record<string, string>;

const requiredEnvString = (key: string) =>
  z.string().min(1, `infra bootstrap: required key is blank: ${key}`);

const envSchema = z
  .object({
    EMQX_DASHBOARD_USERNAME: requiredEnvString('EMQX_DASHBOARD_USERNAME'),
    EMQX_DASHBOARD_PASSWORD: requiredEnvString('EMQX_DASHBOARD_PASSWORD'),
    EMQX_BACKEND_MQTT_USERNAME: requiredEnvString('EMQX_BACKEND_MQTT_USERNAME'),
    EMQX_BACKEND_MQTT_PASSWORD: requiredEnvString('EMQX_BACKEND_MQTT_PASSWORD'),
    EMQX_AGENT_MQTT_USERNAME: requiredEnvString('EMQX_AGENT_MQTT_USERNAME'),
    EMQX_AGENT_MQTT_PASSWORD: requiredEnvString('EMQX_AGENT_MQTT_PASSWORD'),
    EMQX_API_URL: z.string().min(1).default('http://localhost:18083/api/v5'),
  })
  .refine(
    (value) => value.EMQX_BACKEND_MQTT_USERNAME !== value.EMQX_AGENT_MQTT_USERNAME,
    'infra bootstrap: backend and agent usernames must be distinct.'
  );

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

type RequestResult = {
  status: number;
  body: string;
};

async function request(
  url: string,
  options: RequestInit = {}
): Promise<RequestResult> {
  const response = await fetch(url, options);
  const body = await response.text();
  return { status: response.status, body };
}

async function main(argv: string[]): Promise<void> {
  const envFile = argv[0] ?? '.env';
  const envPath = path.resolve(process.cwd(), envFile);

  if (!fs.existsSync(envPath)) {
    throw new Error(`infra bootstrap: env file not found: ${envFile}`);
  }

  const parsedEnv = envSchema.safeParse(parseEnvFile(fs.readFileSync(envPath, 'utf8')));
  if (!parsedEnv.success) {
    const firstIssue = parsedEnv.error.issues[0];
    throw new Error(firstIssue?.message ?? 'infra bootstrap: invalid env configuration.');
  }
  const env = parsedEnv.data;

  const backendUsername = env.EMQX_BACKEND_MQTT_USERNAME;
  const backendPassword = env.EMQX_BACKEND_MQTT_PASSWORD;
  const agentUsername = env.EMQX_AGENT_MQTT_USERNAME;
  const agentPassword = env.EMQX_AGENT_MQTT_PASSWORD;
  const dashboardUsername = env.EMQX_DASHBOARD_USERNAME;
  const dashboardPassword = env.EMQX_DASHBOARD_PASSWORD;
  const apiUrl = env.EMQX_API_URL;
  const authenticatorUrl = `${apiUrl}/authentication/password_based%3Abuilt_in_database`;

  const loginResponse = await request(`${apiUrl}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      username: dashboardUsername,
      password: dashboardPassword,
    }),
  });

  if (loginResponse.status < 200 || loginResponse.status >= 300) {
    process.stderr.write(
      `infra bootstrap: failed EMQX login (HTTP ${loginResponse.status}).\n`
    );
    if (loginResponse.body !== '') {
      process.stderr.write(`${loginResponse.body}\n`);
    }
    process.exit(1);
  }

  let token = '';
  try {
    const parsed = JSON.parse(loginResponse.body) as { token?: string };
    token = parsed.token ?? '';
  } catch {
    token = '';
  }

  if (token === '') {
    throw new Error('infra bootstrap: failed to read EMQX API token from login response.');
  }

  const authHeader = { Authorization: `Bearer ${token}` };

  const authnCheck = await request(authenticatorUrl, {
    headers: authHeader,
  });

  if (authnCheck.status !== 200) {
    process.stderr.write(
      `infra bootstrap: expected password_based:built_in_database authenticator (HTTP ${authnCheck.status}).\n`
    );
    if (authnCheck.body !== '') {
      process.stderr.write(`${authnCheck.body}\n`);
    }
    process.exit(1);
  }

  async function upsertUser(userId: string, password: string): Promise<void> {
    const createResponse = await request(`${authenticatorUrl}/users`, {
      method: 'POST',
      headers: {
        ...authHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        password,
        is_superuser: false,
      }),
    });

    if (createResponse.status === 200 || createResponse.status === 201) {
      process.stdout.write(`infra bootstrap: ensured MQTT user ${userId}.\n`);
      return;
    }

    if (createResponse.status !== 400 && createResponse.status !== 409) {
      process.stderr.write(
        `infra bootstrap: failed to create MQTT user ${userId} (HTTP ${createResponse.status}).\n`
      );
      if (createResponse.body !== '') {
        process.stderr.write(`${createResponse.body}\n`);
      }
      process.exit(1);
    }

    const updateResponse = await request(`${authenticatorUrl}/users/${userId}`, {
      method: 'PUT',
      headers: {
        ...authHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        password,
        is_superuser: false,
      }),
    });

    if (updateResponse.status === 200 || updateResponse.status === 204) {
      process.stdout.write(`infra bootstrap: updated MQTT user ${userId}.\n`);
      return;
    }

    process.stderr.write(
      `infra bootstrap: failed to update MQTT user ${userId} (HTTP ${updateResponse.status}).\n`
    );
    if (updateResponse.body !== '') {
      process.stderr.write(`${updateResponse.body}\n`);
    }
    process.exit(1);
  }

  await upsertUser(backendUsername, backendPassword);
  await upsertUser(agentUsername, agentPassword);

  process.stdout.write('infra bootstrap: EMQX authentication users are configured.\n');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
