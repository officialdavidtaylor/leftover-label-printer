import { z } from 'zod';

const RANDOM_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

const tokenEndpointSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

export type TokenEndpointResponse = {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  scope?: string;
  idToken?: string;
};

export type ExchangeAuthorizationCodeInput = {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
};

export type CreateAuthorizationUrlInput = {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  audience: string;
  scope: string;
  state: string;
  codeChallenge: string;
};

export function createAuthorizationUrl(input: CreateAuthorizationUrlInput): string {
  const authorizeUrl = new URL('authorize', ensureTrailingSlash(input.issuerUrl));

  authorizeUrl.searchParams.set('client_id', input.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', input.redirectUri);
  authorizeUrl.searchParams.set('scope', input.scope);
  authorizeUrl.searchParams.set('audience', input.audience);
  authorizeUrl.searchParams.set('state', input.state);
  authorizeUrl.searchParams.set('code_challenge', input.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return authorizeUrl.toString();
}

export async function exchangeAuthorizationCode(
  input: ExchangeAuthorizationCodeInput
): Promise<TokenEndpointResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenUrl = new URL('token', ensureTrailingSlash(input.issuerUrl));

  const formBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });

  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: formBody,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed with status ${response.status}`);
  }

  const payload = await response.json();
  const parsedPayload = tokenEndpointSchema.parse(payload);

  return {
    accessToken: parsedPayload.access_token,
    tokenType: parsedPayload.token_type,
    expiresInSeconds: parsedPayload.expires_in,
    scope: parsedPayload.scope,
    idToken: parsedPayload.id_token,
  };
}

export function createRandomState(byteLength: number = 32): string {
  return createRandomString(byteLength);
}

export function createRandomCodeVerifier(byteLength: number = 64): string {
  return createRandomString(byteLength);
}

export async function createPkceCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return toBase64Url(digest);
}

function createRandomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(bytes, (value) => RANDOM_CHARSET[value % RANDOM_CHARSET.length]).join('');
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
