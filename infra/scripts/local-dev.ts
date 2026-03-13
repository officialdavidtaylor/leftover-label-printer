import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

const canonicalRoleSchema = z.enum(['user', 'sysadmin']);

const envSchema = z
  .object({
    COMPOSE_PROJECT_NAME: z.string().trim().min(1).default('leftover-label-printer'),
    KEYCLOAK_ADMIN_USERNAME: z.string().trim().min(1),
    KEYCLOAK_ADMIN_PASSWORD: z.string().trim().min(1),
    MINIO_ROOT_USER: z.string().trim().min(1),
    MINIO_ROOT_PASSWORD: z.string().trim().min(1),
    EMQX_BACKEND_MQTT_USERNAME: z.string().trim().min(1),
    EMQX_AGENT_MQTT_USERNAME: z.string().trim().min(1),
    DEV_KEYCLOAK_BASE_URL: z.string().trim().url().default('http://localhost:9000'),
    DEV_KEYCLOAK_BOOTSTRAP_BASE_URL: z.string().trim().url().default('http://127.0.0.1:9000'),
    DEV_OIDC_REALM: z.string().trim().min(1).default('leftover-label-printer'),
    DEV_OIDC_AUDIENCE: z.string().trim().min(1).default('leftover-label-printer-api'),
    DEV_OIDC_DEV_CLIENT_ID: z.string().trim().min(1).default('leftover-label-printer-dev-cli'),
    DEV_OIDC_DEV_USERNAME: z.string().trim().min(1).default('dev-user'),
    DEV_OIDC_DEV_PASSWORD: z.string().trim().min(1).default('dev-password'),
    DEV_OIDC_DEV_ROLES: z.string().trim().min(1).default('user'),
    DEV_BACKEND_BASE_URL: z.string().trim().url().default('http://localhost:8080'),
    DEV_PRINTER_ID: z.string().trim().min(1).default('printer-01'),
    DEV_PRINTER_LOCATION: z.string().trim().min(1).default('Local Dev Bench'),
    DEV_TEMPLATE_ID: z.string().trim().min(1).default('label-default'),
    DEV_TEMPLATE_VERSION: z.string().trim().min(1).default('v1'),
    DEV_MINIO_BASE_URL: z.string().trim().url().default('http://localhost:9002'),
    DEV_S3_BUCKET: z.string().trim().min(1).default('leftover-label-printer'),
    DEV_S3_REGION: z.string().trim().min(1).default('us-east-1'),
    DEV_MOCK_PRINT_FAIL_MARKER: z.string().trim().min(1).default('[mock-fail]'),
  })
  .superRefine((value, ctx) => {
    if (value.EMQX_BACKEND_MQTT_USERNAME === value.EMQX_AGENT_MQTT_USERNAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMQX_AGENT_MQTT_USERNAME'],
        message: 'infra local dev: backend and agent MQTT usernames must be distinct.',
      });
    }

    if (value.EMQX_AGENT_MQTT_USERNAME !== value.DEV_PRINTER_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMQX_AGENT_MQTT_USERNAME'],
        message: 'infra local dev: EMQX_AGENT_MQTT_USERNAME must match DEV_PRINTER_ID for ACL-backed mock-agent auth.',
      });
    }
  });

export type LocalDevConfig = {
  envFilePath: string;
  repoRoot: string;
  infraDir: string;
  artifactDir: string;
  composeProjectName: string;
  keycloakAdminUsername: string;
  keycloakAdminPassword: string;
  minioRootUser: string;
  minioRootPassword: string;
  keycloakBaseUrl: string;
  keycloakBootstrapBaseUrl: string;
  oidcRealm: string;
  oidcIssuerUrl: string;
  oidcAudience: string;
  devClientId: string;
  devUsername: string;
  devPassword: string;
  devRoles: Array<z.infer<typeof canonicalRoleSchema>>;
  backendBaseUrl: string;
  printerId: string;
  printerLocation: string;
  templateId: string;
  templateVersion: string;
  minioBaseUrl: string;
  s3Bucket: string;
  s3Region: string;
  mockPrintFailMarker: string;
};

type KeycloakClientRepresentation = {
  id: string;
  clientId: string;
  publicClient?: boolean;
  directAccessGrantsEnabled?: boolean;
  standardFlowEnabled?: boolean;
  enabled?: boolean;
  protocol?: string;
};

type KeycloakUserRepresentation = {
  id: string;
  username: string;
  enabled?: boolean;
  emailVerified?: boolean;
};

type KeycloakRoleRepresentation = {
  id?: string;
  name: string;
};

type Logger = (message: string) => void;

export function parseEnvFile(envText: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const rawLine of envText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
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

export function parseLocalDevConfig(envText: string, envFilePath: string): LocalDevConfig {
  const parsed = envSchema.safeParse(parseEnvFile(envText));
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'infra local dev: invalid env configuration.');
  }

  const roles = parsed.data.DEV_OIDC_DEV_ROLES.split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  if (roles.length === 0) {
    throw new Error('infra local dev: DEV_OIDC_DEV_ROLES must include at least one canonical role.');
  }

  const devRoles = roles.map((role) => {
    const result = canonicalRoleSchema.safeParse(role);
    if (!result.success) {
      throw new Error(`infra local dev: unsupported DEV_OIDC_DEV_ROLES value: ${role}`);
    }

    return result.data;
  });

  const absoluteEnvFilePath = path.resolve(envFilePath);
  const infraDir = path.dirname(absoluteEnvFilePath);
  const repoRoot = path.resolve(infraDir, '..');

  return {
    envFilePath: absoluteEnvFilePath,
    repoRoot,
    infraDir,
    artifactDir: path.resolve(infraDir, 'dev-artifacts'),
    composeProjectName: parsed.data.COMPOSE_PROJECT_NAME,
    keycloakAdminUsername: parsed.data.KEYCLOAK_ADMIN_USERNAME,
    keycloakAdminPassword: parsed.data.KEYCLOAK_ADMIN_PASSWORD,
    minioRootUser: parsed.data.MINIO_ROOT_USER,
    minioRootPassword: parsed.data.MINIO_ROOT_PASSWORD,
    keycloakBaseUrl: withoutTrailingSlash(parsed.data.DEV_KEYCLOAK_BASE_URL),
    keycloakBootstrapBaseUrl: withoutTrailingSlash(parsed.data.DEV_KEYCLOAK_BOOTSTRAP_BASE_URL),
    oidcRealm: parsed.data.DEV_OIDC_REALM,
    oidcIssuerUrl: `${withoutTrailingSlash(parsed.data.DEV_KEYCLOAK_BASE_URL)}/realms/${parsed.data.DEV_OIDC_REALM}`,
    oidcAudience: parsed.data.DEV_OIDC_AUDIENCE,
    devClientId: parsed.data.DEV_OIDC_DEV_CLIENT_ID,
    devUsername: parsed.data.DEV_OIDC_DEV_USERNAME,
    devPassword: parsed.data.DEV_OIDC_DEV_PASSWORD,
    devRoles,
    backendBaseUrl: withoutTrailingSlash(parsed.data.DEV_BACKEND_BASE_URL),
    printerId: parsed.data.DEV_PRINTER_ID,
    printerLocation: parsed.data.DEV_PRINTER_LOCATION,
    templateId: parsed.data.DEV_TEMPLATE_ID,
    templateVersion: parsed.data.DEV_TEMPLATE_VERSION,
    minioBaseUrl: withoutTrailingSlash(parsed.data.DEV_MINIO_BASE_URL),
    s3Bucket: parsed.data.DEV_S3_BUCKET,
    s3Region: parsed.data.DEV_S3_REGION,
    mockPrintFailMarker: parsed.data.DEV_MOCK_PRINT_FAIL_MARKER,
  };
}

export function readLocalDevConfig(envFile: string, cwd: string = process.cwd()): LocalDevConfig {
  const envFilePath = path.resolve(cwd, envFile);

  if (!fs.existsSync(envFilePath)) {
    throw new Error(`infra local dev: env file not found: ${envFile}`);
  }

  return parseLocalDevConfig(fs.readFileSync(envFilePath, 'utf8'), envFilePath);
}

export async function bootstrapLocalDev(config: LocalDevConfig, logger: Logger = console.log): Promise<void> {
  fs.mkdirSync(config.artifactDir, { recursive: true });
  logger(`infra local dev: ensured artifact directory ${config.artifactDir}.`);

  await ensureMinioBucket(config, logger);
  authenticateKeycloakAdmin(config);
  await ensureKeycloakRealm(config, logger);
}

export async function mintLocalDevAccessToken(config: LocalDevConfig): Promise<string> {
  const tokenUrl = `${config.keycloakBootstrapBaseUrl}/realms/${config.oidcRealm}/protocol/openid-connect/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: config.devClientId,
      username: config.devUsername,
      password: config.devPassword,
      scope: 'openid',
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`infra local dev: failed to mint dev token (HTTP ${response.status}).\n${body}`);
  }

  let parsed: { access_token?: string } = {};
  try {
    parsed = JSON.parse(body) as { access_token?: string };
  } catch {
    parsed = {};
  }

  if (!parsed.access_token) {
    throw new Error('infra local dev: token response did not include access_token.');
  }

  return parsed.access_token;
}

async function ensureMinioBucket(config: LocalDevConfig, logger: Logger): Promise<void> {
  const client = new S3Client({
    endpoint: config.minioBaseUrl,
    region: config.s3Region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.minioRootUser,
      secretAccessKey: config.minioRootPassword,
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
    logger(`infra local dev: ensured MinIO bucket ${config.s3Bucket}.`);
  } catch (error) {
    if (!isMissingBucketError(error)) {
      throw error;
    }

    await client.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
    logger(`infra local dev: created MinIO bucket ${config.s3Bucket}.`);
  } finally {
    client.destroy();
  }
}

function authenticateKeycloakAdmin(config: LocalDevConfig): void {
  runKeycloakAdmin(config, [
    'config',
    'credentials',
    '--server',
    'http://127.0.0.1:8080',
    '--realm',
    'master',
    '--user',
    config.keycloakAdminUsername,
    '--password',
    config.keycloakAdminPassword,
  ]);
}

async function ensureKeycloakRealm(config: LocalDevConfig, logger: Logger): Promise<void> {
  const realmPayload = {
    realm: config.oidcRealm,
    enabled: true,
    sslRequired: 'NONE',
    displayName: 'Leftover Label Printer (Local Dev)',
  };

  if (!keycloakResourceExists(config, [`get`, `realms/${config.oidcRealm}`])) {
    runKeycloakAdmin(config, ['create', 'realms', '-f', '/dev/stdin'], realmPayload);
    logger(`infra local dev: created Keycloak realm ${config.oidcRealm}.`);
  }

  runKeycloakAdmin(config, ['update', `realms/${config.oidcRealm}`, '-f', '/dev/stdin'], realmPayload);
  logger(`infra local dev: ensured Keycloak realm ${config.oidcRealm}.`);

  ensureRealmRole(config, 'user', logger);
  ensureRealmRole(config, 'sysadmin', logger);

  const client = ensureDevClient(config, logger);
  ensureClientRole(config, client.id, 'user', logger);
  ensureClientRole(config, client.id, 'sysadmin', logger);
  ensureProtocolMapper(config, client.id, {
    name: 'canonical-roles',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-client-role-mapper',
    config: {
      'usermodel.clientRoleMapping.clientId': config.devClientId,
      multivalued: 'true',
      'access.token.claim': 'true',
      'id.token.claim': 'false',
      'userinfo.token.claim': 'false',
      'claim.name': 'roles',
      'jsonType.label': 'String',
    },
  });
  ensureProtocolMapper(config, client.id, {
    name: 'api-audience',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-audience-mapper',
    config: {
      'access.token.claim': 'true',
      'id.token.claim': 'false',
      'userinfo.token.claim': 'false',
      'included.custom.audience': config.oidcAudience,
    },
  });

  ensureDevUser(config, logger);
  ensureUserPassword(config);
  ensureUserRealmRoles(config, config.devRoles, logger);
  ensureUserClientRoles(config, config.devRoles, logger);
}

function ensureRealmRole(config: LocalDevConfig, roleName: z.infer<typeof canonicalRoleSchema>, logger: Logger): void {
  if (!keycloakResourceExists(config, ['get', `roles/${roleName}`, '-r', config.oidcRealm])) {
    runKeycloakAdmin(
      config,
      ['create', 'roles', '-r', config.oidcRealm, '-f', '/dev/stdin'],
      { name: roleName }
    );
    logger(`infra local dev: created Keycloak realm role ${roleName}.`);
    return;
  }

  logger(`infra local dev: ensured Keycloak realm role ${roleName}.`);
}

function ensureDevClient(config: LocalDevConfig, logger: Logger): KeycloakClientRepresentation {
  const clientPayload = {
    clientId: config.devClientId,
    name: 'Leftover Label Printer Local Dev CLI',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    fullScopeAllowed: false,
  };

  const existingClient = getKeycloakClient(config);
  if (!existingClient) {
    runKeycloakAdmin(config, ['create', 'clients', '-r', config.oidcRealm, '-f', '/dev/stdin'], clientPayload);
    logger(`infra local dev: created Keycloak client ${config.devClientId}.`);
  } else {
    runKeycloakAdmin(
      config,
      ['update', `clients/${existingClient.id}`, '-r', config.oidcRealm, '-f', '/dev/stdin'],
      {
        ...existingClient,
        ...clientPayload,
      }
    );
    logger(`infra local dev: ensured Keycloak client ${config.devClientId}.`);
  }

  const client = getKeycloakClient(config);
  if (!client) {
    throw new Error(`infra local dev: failed to resolve Keycloak client ${config.devClientId} after create/update.`);
  }

  return client;
}

function ensureClientRole(
  config: LocalDevConfig,
  clientId: string,
  roleName: z.infer<typeof canonicalRoleSchema>,
  logger: Logger
): void {
  if (!keycloakResourceExists(config, ['get', `clients/${clientId}/roles/${roleName}`, '-r', config.oidcRealm])) {
    runKeycloakAdmin(
      config,
      ['create', `clients/${clientId}/roles`, '-r', config.oidcRealm, '-f', '/dev/stdin'],
      { name: roleName }
    );
    logger(`infra local dev: created Keycloak client role ${roleName}.`);
    return;
  }

  logger(`infra local dev: ensured Keycloak client role ${roleName}.`);
}

function ensureProtocolMapper(
  config: LocalDevConfig,
  clientId: string,
  mapper: {
    name: string;
    protocol: 'openid-connect';
    protocolMapper: string;
    config: Record<string, string>;
  }
): void {
  const mappers = parseJson<Array<{ id: string; name: string }>>(
    runKeycloakAdmin(config, ['get', `clients/${clientId}/protocol-mappers/models`, '-r', config.oidcRealm])
  );
  const existingMapper = mappers.find((candidate) => candidate.name === mapper.name);
  const mapperPayload = {
    name: mapper.name,
    protocol: mapper.protocol,
    protocolMapper: mapper.protocolMapper,
    config: mapper.config,
  };

  if (!existingMapper) {
    runKeycloakAdmin(
      config,
      ['create', `clients/${clientId}/protocol-mappers/models`, '-r', config.oidcRealm, '-f', '/dev/stdin'],
      mapperPayload
    );
    return;
  }

  runKeycloakAdmin(
    config,
    [
      'update',
      `clients/${clientId}/protocol-mappers/models/${existingMapper.id}`,
      '-r',
      config.oidcRealm,
      '-f',
      '/dev/stdin',
    ],
    {
      id: existingMapper.id,
      ...mapperPayload,
    }
  );
}

function ensureDevUser(config: LocalDevConfig, logger: Logger): void {
  const userPayload = {
    username: config.devUsername,
    firstName: 'Dev',
    lastName: 'User',
    email: `${config.devUsername}@local.test`,
    enabled: true,
    emailVerified: true,
    attributes: {
      roles: config.devRoles,
    },
  };

  const existingUser = getKeycloakUser(config);
  if (!existingUser) {
    runKeycloakAdmin(config, ['create', 'users', '-r', config.oidcRealm, '-f', '/dev/stdin'], userPayload);
    logger(`infra local dev: created Keycloak user ${config.devUsername}.`);
    return;
  }

  runKeycloakAdmin(
    config,
    ['update', `users/${existingUser.id}`, '-r', config.oidcRealm, '-f', '/dev/stdin'],
    {
      ...existingUser,
      ...userPayload,
    }
  );
  logger(`infra local dev: ensured Keycloak user ${config.devUsername}.`);
}

function ensureUserPassword(config: LocalDevConfig): void {
  const user = getKeycloakUser(config);
  if (!user) {
    throw new Error(`infra local dev: failed to resolve Keycloak user ${config.devUsername} before password reset.`);
  }

  runKeycloakAdmin(
    config,
    ['update', `users/${user.id}/reset-password`, '-r', config.oidcRealm, '-f', '/dev/stdin'],
    {
      type: 'password',
      temporary: false,
      value: config.devPassword,
    }
  );
}

function ensureUserRealmRoles(
  config: LocalDevConfig,
  roles: Array<z.infer<typeof canonicalRoleSchema>>,
  logger: Logger
): void {
  for (const roleName of roles) {
    runKeycloakAdmin(config, [
      'add-roles',
      '-r',
      config.oidcRealm,
      '--uusername',
      config.devUsername,
      '--rolename',
      roleName,
    ]);
  }

  logger(`infra local dev: assigned Keycloak roles ${roles.join(', ')} to ${config.devUsername}.`);
}

function ensureUserClientRoles(
  config: LocalDevConfig,
  roles: Array<z.infer<typeof canonicalRoleSchema>>,
  logger: Logger
): void {
  for (const roleName of roles) {
    runKeycloakAdmin(config, [
      'add-roles',
      '-r',
      config.oidcRealm,
      '--uusername',
      config.devUsername,
      '--cclientid',
      config.devClientId,
      '--rolename',
      roleName,
    ]);
  }

  logger(`infra local dev: assigned Keycloak client roles ${roles.join(', ')} to ${config.devUsername}.`);
}

function getKeycloakClient(config: LocalDevConfig): KeycloakClientRepresentation | null {
  const clients = parseJson<KeycloakClientRepresentation[]>(
    runKeycloakAdmin(config, ['get', 'clients', '-r', config.oidcRealm, '-q', `clientId=${config.devClientId}`])
  );

  return clients[0] ?? null;
}

function getKeycloakUser(config: LocalDevConfig): KeycloakUserRepresentation | null {
  const users = parseJson<KeycloakUserRepresentation[]>(
    runKeycloakAdmin(
      config,
      ['get', 'users', '-r', config.oidcRealm, '-q', `username=${config.devUsername}`, '-q', 'exact=true']
    )
  );

  return users[0] ?? null;
}

function keycloakResourceExists(config: LocalDevConfig, args: string[]): boolean {
  try {
    runKeycloakAdmin(config, args);
    return true;
  } catch {
    return false;
  }
}

function runKeycloakAdmin(config: LocalDevConfig, args: string[], input?: unknown): string {
  const command = [
    'exec',
    ...(input === undefined ? [] : ['-i']),
    `${config.composeProjectName}-keycloak-1`,
    '/opt/keycloak/bin/kcadm.sh',
    ...args,
  ];

  const result = spawnSync('docker', command, {
    cwd: config.repoRoot,
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const details = stderr !== '' ? stderr : stdout;
    throw new Error(`infra local dev: Keycloak admin command failed: docker ${command.join(' ')}\n${details}`);
  }

  return result.stdout;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function isMissingBucketError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchBucket' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
