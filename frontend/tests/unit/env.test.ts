import { describe, expect, it } from 'vitest';

import { parseFrontendEnv } from '../../app/lib/env';

describe('parseFrontendEnv', () => {
  it('applies local defaults when values are omitted', () => {
    const parsed = parseFrontendEnv({});

    expect(parsed).toMatchObject({
      apiBaseUrl: '/api',
      oidcIssuerUrl: 'http://localhost:9000/realms/leftover-label-printer',
      oidcClientId: 'leftover-label-printer-pwa',
      oidcAudience: 'leftover-label-printer-api',
      defaultPrinterId: 'printer-1',
      defaultTemplateId: 'label-default',
      defaultTemplateVersion: 'v1',
    });
    expect(parsed.oidcUsePkce).toBe(true);
  });

  it('parses explicit values from runtime env', () => {
    const parsed = parseFrontendEnv({
      VITE_API_BASE_URL: '/custom-api',
      VITE_OIDC_ISSUER_URL: 'https://auth.example.com/realms/app',
      VITE_OIDC_CLIENT_ID: 'custom-client',
      VITE_OIDC_AUDIENCE: 'custom-audience',
      VITE_OIDC_RESPONSE_TYPE: 'code',
      VITE_OIDC_USE_PKCE: 'false',
      VITE_DEFAULT_PRINTER_ID: 'printer-kitchen',
      VITE_DEFAULT_TEMPLATE_ID: 'label-custom',
      VITE_DEFAULT_TEMPLATE_VERSION: 'v2',
    });

    expect(parsed).toMatchObject({
      apiBaseUrl: '/custom-api',
      oidcIssuerUrl: 'https://auth.example.com/realms/app',
      oidcUsePkce: false,
      defaultPrinterId: 'printer-kitchen',
      defaultTemplateId: 'label-custom',
      defaultTemplateVersion: 'v2',
    });
  });
});
