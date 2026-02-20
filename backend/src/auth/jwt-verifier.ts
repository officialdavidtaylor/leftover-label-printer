import { createPublicKey, verify } from 'node:crypto';

import { CANONICAL_ROLES_CLAIM } from './roles.ts';

export type AuthFailureReason =
  | 'malformed_token'
  | 'invalid_signature'
  | 'missing_required_claim'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'expired_token'
  | 'discovery_fetch_failed'
  | 'jwks_fetch_failed';

export class UnauthorizedError extends Error {
  readonly reason: AuthFailureReason;

  constructor(reason: AuthFailureReason) {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
    this.reason = reason;
  }
}

export type OidcJwtVerifierConfig = {
  issuerUrl: string;
  audience: string;
  rolesClaim?: string;
  discoveryUrl?: string;
  discoveryCacheTtlMs?: number;
  jwksCacheTtlMs?: number;
};

export type VerifiedJwtContext = {
  subject: string;
  issuer: string;
  audience: string[];
  roles: string[];
  expiresAt: number;
  claims: Record<string, unknown>;
};

type FetchLike = typeof fetch;

type DiscoveryDoc = {
  issuer: string;
  jwks_uri: string;
};

type JwkSet = {
  keys: JsonWebKey[];
};

type CachedValue<T> = {
  value: T;
  expiresAt: number;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = Record<string, unknown>;

export class OidcJwtVerifier {
  private readonly rolesClaim: string;
  private readonly discoveryUrl: string;
  private readonly discoveryCacheTtlMs: number;
  private readonly jwksCacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  private discoveryCache: CachedValue<DiscoveryDoc> | null = null;
  private jwksCache: CachedValue<JwkSet> | null = null;

  constructor(
    private readonly config: OidcJwtVerifierConfig,
    deps: { fetchImpl?: FetchLike; now?: () => number } = {}
  ) {
    this.rolesClaim = config.rolesClaim ?? CANONICAL_ROLES_CLAIM;
    this.discoveryUrl =
      config.discoveryUrl ?? new URL('.well-known/openid-configuration', config.issuerUrl).toString();
    this.discoveryCacheTtlMs = config.discoveryCacheTtlMs ?? 300_000;
    this.jwksCacheTtlMs = config.jwksCacheTtlMs ?? 300_000;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  async verifyAccessToken(token: string): Promise<VerifiedJwtContext> {
    const nowEpochMs = this.now();
    const nowEpochSec = Math.floor(nowEpochMs / 1_000);
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new UnauthorizedError('malformed_token');
    }

    const header = parseJwtHeader(parts[0]);
    const payload = parseJwtPayload(parts[1]);
    const signature = base64UrlDecode(parts[2]);

    if (!header.alg || header.alg !== 'RS256') {
      throw new UnauthorizedError('malformed_token');
    }

    const issuer = getRequiredStringClaim(payload, 'iss');
    if (issuer !== this.config.issuerUrl) {
      throw new UnauthorizedError('invalid_issuer');
    }

    const audienceClaim = payload.aud;
    const audiences = parseAudience(audienceClaim);
    if (!audiences.includes(this.config.audience)) {
      throw new UnauthorizedError('invalid_audience');
    }

    const subject = getRequiredStringClaim(payload, 'sub');
    const exp = getRequiredNumericClaim(payload, 'exp');
    if (exp <= nowEpochSec) {
      throw new UnauthorizedError('expired_token');
    }

    const roles = parseRolesClaim(payload, this.rolesClaim);
    if (!roles) {
      throw new UnauthorizedError('missing_required_claim');
    }

    const discovery = await this.getDiscovery(nowEpochMs);
    const key = await this.getSigningKey(discovery.jwks_uri, header.kid, nowEpochMs);
    if (!key) {
      throw new UnauthorizedError('invalid_signature');
    }

    const signedContent = Buffer.from(`${parts[0]}.${parts[1]}`);
    const isValid = verify(
      'RSA-SHA256',
      signedContent,
      createPublicKey({ key, format: 'jwk' }),
      signature
    );
    if (!isValid) {
      throw new UnauthorizedError('invalid_signature');
    }

    return {
      subject,
      issuer,
      audience: audiences,
      roles,
      expiresAt: exp,
      claims: payload,
    };
  }

  private async getDiscovery(nowEpochMs: number): Promise<DiscoveryDoc> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > nowEpochMs) {
      return this.discoveryCache.value;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.discoveryUrl);
    } catch {
      throw new UnauthorizedError('discovery_fetch_failed');
    }

    if (!response.ok) {
      throw new UnauthorizedError('discovery_fetch_failed');
    }

    const discoveryDoc = (await response.json()) as Partial<DiscoveryDoc>;
    if (
      !discoveryDoc ||
      typeof discoveryDoc.issuer !== 'string' ||
      typeof discoveryDoc.jwks_uri !== 'string'
    ) {
      throw new UnauthorizedError('discovery_fetch_failed');
    }

    if (discoveryDoc.issuer !== this.config.issuerUrl) {
      throw new UnauthorizedError('discovery_fetch_failed');
    }

    this.discoveryCache = {
      value: {
        issuer: discoveryDoc.issuer,
        jwks_uri: discoveryDoc.jwks_uri,
      },
      expiresAt: nowEpochMs + this.discoveryCacheTtlMs,
    };

    return this.discoveryCache.value;
  }

  private async getSigningKey(
    jwksUrl: string,
    kid: string | undefined,
    nowEpochMs: number
  ): Promise<JsonWebKey | undefined> {
    let jwks = await this.getJwks(jwksUrl, nowEpochMs, false);
    let key = findSigningKey(jwks, kid);

    // Key rotation path: refresh JWKS if key is missing in cache.
    if (!key) {
      jwks = await this.getJwks(jwksUrl, nowEpochMs, true);
      key = findSigningKey(jwks, kid);
    }

    return key;
  }

  private async getJwks(jwksUrl: string, nowEpochMs: number, forceRefresh: boolean): Promise<JwkSet> {
    if (!forceRefresh && this.jwksCache && this.jwksCache.expiresAt > nowEpochMs) {
      return this.jwksCache.value;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(jwksUrl);
    } catch {
      throw new UnauthorizedError('jwks_fetch_failed');
    }

    if (!response.ok) {
      throw new UnauthorizedError('jwks_fetch_failed');
    }

    const jwks = (await response.json()) as Partial<JwkSet>;
    if (!jwks || !Array.isArray(jwks.keys)) {
      throw new UnauthorizedError('jwks_fetch_failed');
    }

    this.jwksCache = {
      value: { keys: jwks.keys },
      expiresAt: nowEpochMs + this.jwksCacheTtlMs,
    };

    return this.jwksCache.value;
  }
}

export type ErrorResponse = {
  code: string;
  message: string;
  traceId?: string;
};

export function buildUnauthorizedError(traceId?: string): ErrorResponse {
  return {
    code: 'unauthorized',
    message: 'Unauthorized',
    ...(traceId ? { traceId } : {}),
  };
}

function parseJwtHeader(encodedHeader: string): JwtHeader {
  const parsed = parseBase64Json(encodedHeader);
  if (!parsed || typeof parsed !== 'object') {
    throw new UnauthorizedError('malformed_token');
  }

  return parsed as JwtHeader;
}

function parseJwtPayload(encodedPayload: string): JwtPayload {
  const parsed = parseBase64Json(encodedPayload);
  if (!parsed || typeof parsed !== 'object') {
    throw new UnauthorizedError('malformed_token');
  }

  return parsed as JwtPayload;
}

function parseBase64Json(encodedValue: string): unknown {
  try {
    return JSON.parse(base64UrlDecode(encodedValue).toString('utf8'));
  } catch {
    throw new UnauthorizedError('malformed_token');
  }
}

function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const withPadding = remainder === 0 ? padded : padded + '='.repeat(4 - remainder);
  return Buffer.from(withPadding, 'base64');
}

function parseAudience(audClaim: unknown): string[] {
  if (typeof audClaim === 'string' && audClaim.trim() !== '') {
    return [audClaim];
  }

  if (Array.isArray(audClaim) && audClaim.every((value) => typeof value === 'string' && value !== '')) {
    return audClaim as string[];
  }

  throw new UnauthorizedError('invalid_audience');
}

function parseRolesClaim(payload: JwtPayload, claimName: string): string[] | null {
  const rawRoles = payload[claimName];
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    return null;
  }

  const roles: string[] = [];
  for (const role of rawRoles) {
    if (typeof role !== 'string' || role.trim() === '') {
      return null;
    }

    roles.push(role);
  }

  return roles;
}

function getRequiredStringClaim(payload: JwtPayload, claimName: string): string {
  const value = payload[claimName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UnauthorizedError('missing_required_claim');
  }

  return value;
}

function getRequiredNumericClaim(payload: JwtPayload, claimName: string): number {
  const value = payload[claimName];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UnauthorizedError('missing_required_claim');
  }

  return value;
}

function findSigningKey(jwks: JwkSet, kid: string | undefined): JsonWebKey | undefined {
  const candidates = jwks.keys.filter((key) => key.kty === 'RSA' && key.use === 'sig');
  if (candidates.length === 0) {
    return undefined;
  }

  if (!kid) {
    return candidates[0];
  }

  return candidates.find((key) => key.kid === kid);
}
