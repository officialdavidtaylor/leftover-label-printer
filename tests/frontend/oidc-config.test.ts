import { describe, expect, it } from 'vitest';

import { parseFrontendOidcConfig } from '../../frontend/src/auth/oidc-config.ts';

describe('frontend oidc config', () => {
  it('parses valid env variables for PKCE auth code flow', () => {
    const config = parseFrontendOidcConfig({
      VITE_API_BASE_URL: 'http://localhost:8080',
      VITE_OIDC_ISSUER_URL: 'http://localhost:9000/application/o/leftover-label-printer/',
      VITE_OIDC_CLIENT_ID: 'leftover-label-printer-pwa',
      VITE_OIDC_AUDIENCE: 'leftover-label-printer-api',
      VITE_OIDC_RESPONSE_TYPE: 'code',
      VITE_OIDC_USE_PKCE: 'true',
    });

    expect(config).toMatchObject({
      responseType: 'code',
      pkceRequired: true,
      scope: 'openid profile email',
    });
  });

  it('rejects non-PKCE or non-code env values', () => {
    expect(() =>
      parseFrontendOidcConfig({
        VITE_API_BASE_URL: 'http://localhost:8080',
        VITE_OIDC_ISSUER_URL: 'http://localhost:9000/application/o/leftover-label-printer/',
        VITE_OIDC_CLIENT_ID: 'leftover-label-printer-pwa',
        VITE_OIDC_AUDIENCE: 'leftover-label-printer-api',
        VITE_OIDC_RESPONSE_TYPE: 'token',
        VITE_OIDC_USE_PKCE: 'false',
      })
    ).toThrow();
  });

  it('rejects non-http issuer or API base URLs', () => {
    expect(() =>
      parseFrontendOidcConfig({
        VITE_API_BASE_URL: 'ftp://localhost:8080',
        VITE_OIDC_ISSUER_URL: 'http://localhost:9000/application/o/leftover-label-printer/',
        VITE_OIDC_CLIENT_ID: 'leftover-label-printer-pwa',
        VITE_OIDC_AUDIENCE: 'leftover-label-printer-api',
        VITE_OIDC_RESPONSE_TYPE: 'code',
        VITE_OIDC_USE_PKCE: 'true',
      })
    ).toThrow();
  });
});
