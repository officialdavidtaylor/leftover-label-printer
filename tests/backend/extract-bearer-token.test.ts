import { describe, expect, it } from 'vitest';

import { extractBearerToken } from '../../backend/src/auth/extract-bearer-token.ts';

describe('extract-bearer-token', () => {
  it('returns token for a valid bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('supports case-insensitive bearer prefix', () => {
    expect(extractBearerToken('bearer token-123')).toBe('token-123');
  });

  it('returns null for missing or non-bearer header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic something')).toBeNull();
  });

  it('returns null for empty bearer token payload', () => {
    expect(extractBearerToken('Bearer    ')).toBeNull();
  });
});
