import { describe, expect, it } from 'vitest';

import {
  CANONICAL_ROLES_CLAIM,
  parseCanonicalRolesClaim,
  validateBackendOidcValidationConfig,
  validateFrontendOidcClientConfig,
} from '../../backend/src/auth/oidc-config.ts';

describe('oidc-config', () => {
  it('validates frontend PKCE config', () => {
    const errors = validateFrontendOidcClientConfig({
      issuerUrl: 'https://auth.example.com/application/o/leftover-label-printer/',
      clientId: 'leftover-label-printer-pwa',
      audience: 'leftover-label-printer-api',
      responseType: 'code',
      pkceRequired: true,
    });

    expect(errors).toEqual([]);
  });

  it('rejects non-PKCE or non-code frontend config', () => {
    const errors = validateFrontendOidcClientConfig({
      issuerUrl: 'https://auth.example.com/application/o/leftover-label-printer/',
      clientId: 'leftover-label-printer-pwa',
      audience: 'leftover-label-printer-api',
      responseType: 'token',
      pkceRequired: false,
    });

    expect(errors).toEqual([
      'responseType must be code for Authorization Code + PKCE',
      'pkceRequired must be true',
    ]);
  });

  it('validates backend issuer/audience/jwks and canonical roles claim name', () => {
    const errors = validateBackendOidcValidationConfig({
      issuerUrl: 'https://auth.example.com/application/o/leftover-label-printer/',
      audience: 'leftover-label-printer-api',
      jwksUrl: 'https://auth.example.com/application/o/leftover-label-printer/jwks/',
      rolesClaim: CANONICAL_ROLES_CLAIM,
    });

    expect(errors).toEqual([]);
  });

  it('rejects backend config when roles claim name is not canonical', () => {
    const errors = validateBackendOidcValidationConfig({
      issuerUrl: 'https://auth.example.com/application/o/leftover-label-printer/',
      audience: 'leftover-label-printer-api',
      jwksUrl: 'https://auth.example.com/application/o/leftover-label-printer/jwks/',
      rolesClaim: 'groups',
    });

    expect(errors).toEqual(['rolesClaim must be roles']);
  });

  it('parses canonical roles claim values for MVP roles', () => {
    const roles = parseCanonicalRolesClaim({
      roles: ['user', 'sysadmin'],
    });

    expect(roles).toEqual(['user', 'sysadmin']);
  });

  it('rejects missing, empty, or unsupported role values', () => {
    expect(parseCanonicalRolesClaim({})).toBeNull();
    expect(parseCanonicalRolesClaim({ roles: [] })).toBeNull();
    expect(parseCanonicalRolesClaim({ roles: ['operator'] })).toBeNull();
    expect(parseCanonicalRolesClaim({ roles: 'user' })).toBeNull();
  });
});
