import { z } from 'zod';

import { validateBackendOidcValidationConfig } from '../auth/oidc-config.ts';

const envSchema = z.object({
  NODE_ENV: z.string().trim().min(1).default('development'),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  BACKEND_LOG_LEVEL: z.string().trim().min(1).default('info'),
  BACKEND_BOOTSTRAP_DEMO_DATA: z.string().trim().optional(),
  BACKEND_BOOTSTRAP_PRINTER_ID: z.string().trim().min(1).default('printer-1'),
  BACKEND_BOOTSTRAP_PRINTER_NODE_ID: z.string().trim().min(1).default('printer-1'),
  BACKEND_BOOTSTRAP_PRINTER_LOCATION: z.string().trim().min(1).default('Prep Kitchen'),
  BACKEND_BOOTSTRAP_TEMPLATE_ID: z.string().trim().min(1).default('label-default'),
  BACKEND_BOOTSTRAP_TEMPLATE_VERSION: z.string().trim().min(1).default('v1'),
  MONGO_URI: z.string().trim().min(1),
  MONGO_DB_NAME: z.string().trim().min(1).default('leftover_label_printer'),
  MQTT_BROKER_URL: z.string().trim().url(),
  MQTT_USERNAME: z.string().trim().min(1),
  MQTT_PASSWORD: z.string().trim().min(1),
  S3_ENDPOINT: z.string().trim().url(),
  S3_REGION: z.string().trim().min(1),
  S3_BUCKET: z.string().trim().min(1),
  S3_ACCESS_KEY_ID: z.string().trim().min(1),
  S3_SECRET_ACCESS_KEY: z.string().trim().min(1),
  OIDC_ISSUER_URL: z.string().trim().url(),
  OIDC_AUDIENCE: z.string().trim().min(1),
  OIDC_JWKS_URL: z.string().trim().url(),
  OIDC_ROLES_CLAIM: z.string().trim().min(1),
});

export type BackendRuntimeConfig = {
  nodeEnv: string;
  port: number;
  logLevel: string;
  bootstrapDemoData: boolean;
  bootstrapPrinterId: string;
  bootstrapPrinterNodeId: string;
  bootstrapPrinterLocation: string;
  bootstrapTemplateId: string;
  bootstrapTemplateVersion: string;
  mongoUri: string;
  mongoDbName: string;
  mqttBrokerUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  oidcIssuerUrl: string;
  oidcAudience: string;
  oidcJwksUrl: string;
  oidcRolesClaim: string;
};

export function loadBackendRuntimeConfig(env: NodeJS.ProcessEnv = process.env): BackendRuntimeConfig {
  const parsed = envSchema.parse(env);
  const oidcErrors = validateBackendOidcValidationConfig({
    issuerUrl: parsed.OIDC_ISSUER_URL,
    audience: parsed.OIDC_AUDIENCE,
    jwksUrl: parsed.OIDC_JWKS_URL,
    rolesClaim: parsed.OIDC_ROLES_CLAIM,
  });

  if (oidcErrors.length > 0) {
    throw new Error(`invalid OIDC configuration: ${oidcErrors.join(', ')}`);
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.BACKEND_PORT,
    logLevel: parsed.BACKEND_LOG_LEVEL,
    bootstrapDemoData: parseBoolean(parsed.BACKEND_BOOTSTRAP_DEMO_DATA, true),
    bootstrapPrinterId: parsed.BACKEND_BOOTSTRAP_PRINTER_ID,
    bootstrapPrinterNodeId: parsed.BACKEND_BOOTSTRAP_PRINTER_NODE_ID,
    bootstrapPrinterLocation: parsed.BACKEND_BOOTSTRAP_PRINTER_LOCATION,
    bootstrapTemplateId: parsed.BACKEND_BOOTSTRAP_TEMPLATE_ID,
    bootstrapTemplateVersion: parsed.BACKEND_BOOTSTRAP_TEMPLATE_VERSION,
    mongoUri: parsed.MONGO_URI,
    mongoDbName: parsed.MONGO_DB_NAME,
    mqttBrokerUrl: parsed.MQTT_BROKER_URL,
    mqttUsername: parsed.MQTT_USERNAME,
    mqttPassword: parsed.MQTT_PASSWORD,
    s3Endpoint: parsed.S3_ENDPOINT,
    s3Region: parsed.S3_REGION,
    s3Bucket: parsed.S3_BUCKET,
    s3AccessKeyId: parsed.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
    oidcIssuerUrl: parsed.OIDC_ISSUER_URL,
    oidcAudience: parsed.OIDC_AUDIENCE,
    oidcJwksUrl: parsed.OIDC_JWKS_URL,
    oidcRolesClaim: parsed.OIDC_ROLES_CLAIM,
  };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  throw new Error(`expected boolean string, received ${value}`);
}
