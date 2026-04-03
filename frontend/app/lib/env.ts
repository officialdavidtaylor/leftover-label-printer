import { z } from 'zod';

const frontendEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().trim().min(1).default('/api'),
  VITE_OIDC_ISSUER_URL: z
    .string()
    .trim()
    .url()
    .default('http://localhost:9000/realms/leftover-label-printer'),
  VITE_OIDC_CLIENT_ID: z.string().trim().min(1).default('leftover-label-printer-pwa'),
  VITE_OIDC_AUDIENCE: z.string().trim().min(1).default('leftover-label-printer-api'),
  VITE_OIDC_RESPONSE_TYPE: z.literal('code').default('code'),
  VITE_OIDC_USE_PKCE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  VITE_DEFAULT_PRINTER_ID: z.string().trim().min(1).default('printer-1'),
  VITE_DEFAULT_TEMPLATE_ID: z.string().trim().min(1).default('label-default'),
  VITE_DEFAULT_TEMPLATE_VERSION: z.string().trim().min(1).default('v1'),
});

export type FrontendEnv = {
  apiBaseUrl: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcAudience: string;
  oidcResponseType: 'code';
  oidcUsePkce: boolean;
  defaultPrinterId: string;
  defaultTemplateId: string;
  defaultTemplateVersion: string;
};

export function parseFrontendEnv(raw: Record<string, string | boolean | undefined>): FrontendEnv {
  const parsed = frontendEnvSchema.parse(raw);

  return {
    apiBaseUrl: parsed.VITE_API_BASE_URL,
    oidcIssuerUrl: parsed.VITE_OIDC_ISSUER_URL,
    oidcClientId: parsed.VITE_OIDC_CLIENT_ID,
    oidcAudience: parsed.VITE_OIDC_AUDIENCE,
    oidcResponseType: parsed.VITE_OIDC_RESPONSE_TYPE,
    oidcUsePkce: parsed.VITE_OIDC_USE_PKCE,
    defaultPrinterId: parsed.VITE_DEFAULT_PRINTER_ID,
    defaultTemplateId: parsed.VITE_DEFAULT_TEMPLATE_ID,
    defaultTemplateVersion: parsed.VITE_DEFAULT_TEMPLATE_VERSION,
  };
}

let cachedEnv: FrontendEnv | null = null;

export function getFrontendEnv(): FrontendEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = parseFrontendEnv(import.meta.env);
  return cachedEnv;
}

export function resetFrontendEnvCache(): void {
  cachedEnv = null;
}
