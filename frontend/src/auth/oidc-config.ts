import { z } from 'zod';

const frontendOidcEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url().refine((value) => isAbsoluteHttpUrl(value), {
    message: 'VITE_API_BASE_URL must be an absolute http(s) URL',
  }),
  VITE_OIDC_ISSUER_URL: z.string().url().refine((value) => isAbsoluteHttpUrl(value), {
    message: 'VITE_OIDC_ISSUER_URL must be an absolute http(s) URL',
  }),
  VITE_OIDC_CLIENT_ID: z.string().trim().min(1),
  VITE_OIDC_AUDIENCE: z.string().trim().min(1),
  VITE_OIDC_RESPONSE_TYPE: z.literal('code'),
  VITE_OIDC_USE_PKCE: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.literal('true')),
});

export type FrontendOidcConfig = {
  apiBaseUrl: string;
  issuerUrl: string;
  clientId: string;
  audience: string;
  responseType: 'code';
  pkceRequired: true;
  scope: string;
};

export type FrontendOidcEnv = Record<string, string | undefined>;

const DEFAULT_OIDC_SCOPE = 'openid profile email';

export function parseFrontendOidcConfig(env: FrontendOidcEnv): FrontendOidcConfig {
  const parsedEnv = frontendOidcEnvSchema.parse(env);

  return {
    apiBaseUrl: parsedEnv.VITE_API_BASE_URL,
    issuerUrl: parsedEnv.VITE_OIDC_ISSUER_URL,
    clientId: parsedEnv.VITE_OIDC_CLIENT_ID,
    audience: parsedEnv.VITE_OIDC_AUDIENCE,
    responseType: parsedEnv.VITE_OIDC_RESPONSE_TYPE,
    pkceRequired: true,
    scope: DEFAULT_OIDC_SCOPE,
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
