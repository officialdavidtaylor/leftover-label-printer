import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildUnauthorizedError,
  OidcJwtVerifier,
  UnauthorizedError,
} from '../../backend/src/auth/jwt-verifier.ts';

type MockOidcProvider = {
  issuerUrl: string;
  discoveryUrl: string;
  fetchImpl: typeof fetch;
  setJwks: (nextKeys: JsonWebKey[]) => void;
  getHits: () => { discovery: number; jwks: number };
};

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

describe('jwt-verifier', () => {
  it('verifies valid access token with canonical roles claim', async () => {
    const key = createRsaSigningKey('key-1');
    const provider = createMockOidcProvider([key.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
        rolesClaim: 'roles',
      },
      { fetchImpl: provider.fetchImpl }
    );

    const token = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
        roles: ['user'],
      },
      key.privateKey,
      key.kid
    );

    const context = await verifier.verifyAccessToken(token);
    expect(context.subject).toBe('user-1');
    expect(context.roles).toEqual(['user']);
    expect(context.issuer).toBe(provider.issuerUrl);
  });

  it('rejects expired tokens', async () => {
    const key = createRsaSigningKey('key-1');
    const provider = createMockOidcProvider([key.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
      },
      { fetchImpl: provider.fetchImpl }
    );

    const token = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(-1),
        roles: ['user'],
      },
      key.privateKey,
      key.kid
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
      reason: 'expired_token',
    });
  });

  it('rejects tokens with wrong issuer', async () => {
    const key = createRsaSigningKey('key-1');
    const provider = createMockOidcProvider([key.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
      },
      { fetchImpl: provider.fetchImpl }
    );

    const token = signAccessToken(
      {
        iss: 'https://unexpected-issuer.example.com/',
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
        roles: ['user'],
      },
      key.privateKey,
      key.kid
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
      reason: 'invalid_issuer',
    });
  });

  it('rejects tokens with wrong audience', async () => {
    const key = createRsaSigningKey('key-1');
    const provider = createMockOidcProvider([key.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
      },
      { fetchImpl: provider.fetchImpl }
    );

    const token = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'some-other-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
        roles: ['user'],
      },
      key.privateKey,
      key.kid
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
      reason: 'invalid_audience',
    });
  });

  it('rejects malformed token payloads', async () => {
    const key = createRsaSigningKey('key-1');
    const provider = createMockOidcProvider([key.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
      },
      { fetchImpl: provider.fetchImpl }
    );

    await expect(verifier.verifyAccessToken('not-a-jwt')).rejects.toMatchObject({
      reason: 'malformed_token',
    });
  });

  it('rejects invalid signatures', async () => {
    const trustedKey = createRsaSigningKey('trusted-key');
    const untrustedKey = createRsaSigningKey('untrusted-key');
    const provider = createMockOidcProvider([trustedKey.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
      },
      { fetchImpl: provider.fetchImpl }
    );

    const token = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
        roles: ['user'],
      },
      untrustedKey.privateKey,
      untrustedKey.kid
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
      reason: 'invalid_signature',
    });
  });

  it('rejects missing or malformed roles claim', async () => {
    const key = createRsaSigningKey('key-1');
    const provider = createMockOidcProvider([key.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
        rolesClaim: 'roles',
      },
      { fetchImpl: provider.fetchImpl }
    );

    const missingRolesToken = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
      },
      key.privateKey,
      key.kid
    );

    const malformedRolesToken = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
        roles: 'user',
      },
      key.privateKey,
      key.kid
    );

    await expect(verifier.verifyAccessToken(missingRolesToken)).rejects.toMatchObject({
      reason: 'missing_required_claim',
    });
    await expect(verifier.verifyAccessToken(malformedRolesToken)).rejects.toMatchObject({
      reason: 'missing_required_claim',
    });
  });

  it('uses cached discovery/JWKS and refreshes JWKS on key rotation', async () => {
    const key1 = createRsaSigningKey('key-1');
    const key2 = createRsaSigningKey('key-2');
    const provider = createMockOidcProvider([key1.publicJwk]);
    const verifier = new OidcJwtVerifier(
      {
        issuerUrl: provider.issuerUrl,
        audience: 'leftover-label-printer-api',
        discoveryUrl: provider.discoveryUrl,
        discoveryCacheTtlMs: 60_000,
        jwksCacheTtlMs: 60_000,
      },
      { fetchImpl: provider.fetchImpl }
    );

    const token1 = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-1',
        exp: epochSecondsFromNow(60),
        roles: ['user'],
      },
      key1.privateKey,
      key1.kid
    );

    await verifier.verifyAccessToken(token1);
    await verifier.verifyAccessToken(token1);
    expect(provider.getHits()).toEqual({ discovery: 1, jwks: 1 });

    provider.setJwks([key2.publicJwk]);
    const token2 = signAccessToken(
      {
        iss: provider.issuerUrl,
        aud: 'leftover-label-printer-api',
        sub: 'user-2',
        exp: epochSecondsFromNow(60),
        roles: ['sysadmin'],
      },
      key2.privateKey,
      key2.kid
    );

    const context = await verifier.verifyAccessToken(token2);
    expect(context.subject).toBe('user-2');
    expect(context.roles).toEqual(['sysadmin']);
    expect(provider.getHits()).toEqual({ discovery: 1, jwks: 2 });
  });
});

describe('jwt-unauthorized-contract', () => {
  it('returns deterministic 401 response shape', () => {
    const body = buildUnauthorizedError('trace-123');
    expect(body).toEqual({
      code: 'unauthorized',
      message: 'Unauthorized',
      traceId: 'trace-123',
    });
  });

  it('aligns with OpenAPI ErrorResponse requirements', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');
    expect(openApiText).toContain("'401':");
    expect(openApiText).toContain("$ref: '#/components/schemas/ErrorResponse'");
    expect(openApiText).toContain('ErrorResponse:');
    expect(openApiText).toContain('- code');
    expect(openApiText).toContain('- message');
  });

  it('provides reason codes for structured logging without exposing token contents', () => {
    const error = new UnauthorizedError('invalid_signature');
    expect(error.reason).toBe('invalid_signature');
    expect(error.message).toBe('Unauthorized');
  });
});

function epochSecondsFromNow(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1_000) + offsetSeconds;
}

function createRsaSigningKey(kid: string): {
  kid: string;
  privateKey: KeyObject;
  publicJwk: JsonWebKey;
} {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = pair.publicKey.export({ format: 'jwk' }) as JsonWebKey;
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: {
      ...publicJwk,
      kid,
      use: 'sig',
      alg: 'RS256',
    },
  };
}

function signAccessToken(payload: Record<string, unknown>, privateKey: KeyObject, kid: string): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };

  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  const encodedSignature = base64UrlEncode(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function base64UrlEncode(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createMockOidcProvider(initialKeys: JsonWebKey[]): MockOidcProvider {
  const issuerUrl = 'https://auth.example.com/application/o/leftover-label-printer/';
  const discoveryUrl = 'https://auth.example.com/.well-known/openid-configuration';
  const jwksUrl = 'https://auth.example.com/application/o/leftover-label-printer/jwks/';
  let jwksKeys = [...initialKeys];
  let discoveryHits = 0;
  let jwksHits = 0;

  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === discoveryUrl) {
      discoveryHits += 1;
      return Response.json({
        issuer: issuerUrl,
        jwks_uri: jwksUrl,
      });
    }

    if (url === jwksUrl) {
      jwksHits += 1;
      return Response.json({
        keys: jwksKeys,
      });
    }

    return new Response(null, { status: 404 });
  };

  return {
    issuerUrl,
    discoveryUrl,
    fetchImpl,
    setJwks(nextKeys) {
      jwksKeys = [...nextKeys];
    },
    getHits() {
      return { discovery: discoveryHits, jwks: jwksHits };
    },
  };
}
