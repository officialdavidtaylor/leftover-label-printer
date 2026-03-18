import { beforeEach, describe, expect, it, vi } from 'vitest';

const signinRedirectCallback = vi.fn();
const removeUser = vi.fn();

vi.mock('oidc-client-ts', () => {
  class UserManager {
    clearStaleState = vi.fn();
    signinRedirect = vi.fn();
    signinRedirectCallback = signinRedirectCallback;
    removeUser = removeUser;
  }

  class WebStorageStateStore {
    constructor(options: unknown) {
      void options;
    }
  }

  return { UserManager, WebStorageStateStore };
});

vi.mock('../../app/lib/env', () => ({
  getFrontendEnv: () => ({
    apiBaseUrl: '/api',
    oidcIssuerUrl: 'http://localhost:9000/realms/leftover-label-printer',
    oidcClientId: 'leftover-label-printer-pwa',
    oidcAudience: 'leftover-label-printer-api',
    oidcResponseType: 'code',
    oidcUsePkce: true,
    defaultPrinterId: 'printer-1',
    defaultTemplateId: 'label-default',
    defaultTemplateVersion: 'v1',
  }),
}));

import { completeAuthentication, resetOidcClient } from '../../app/lib/auth/oidc-client';
import { readStoredSession } from '../../app/lib/auth/session-storage';

function createUnsignedToken(payload: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.signature`;
}
describe('completeAuthentication', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetOidcClient();
    signinRedirectCallback.mockReset();
    removeUser.mockReset();
  });

  it('normalizes the oidc callback result and persists the session', async () => {
    signinRedirectCallback.mockResolvedValue({
      access_token: 'access-token',
      id_token: 'id-token',
      expires_at: Math.floor(Date.now() / 1000) + 600,
      profile: {
        sub: 'user-123',
        roles: ['user'],
        name: 'Kitchen Operator',
        email: 'user@example.com',
      },
      state: {
        returnTo: '/app/print/new',
      },
    });

    const result = await completeAuthentication('http://localhost/auth/callback?code=test');

    expect(result.returnTo).toBe('/app/print/new');
    expect(readStoredSession()).toMatchObject({
      userId: 'user-123',
      roles: ['user'],
      name: 'Kitchen Operator',
      email: 'user@example.com',
    });
  });

  it('falls back to access token role claims when the profile omits roles', async () => {
    signinRedirectCallback.mockResolvedValue({
      access_token: createUnsignedToken({
        sub: 'user-123',
        roles: ['user'],
      }),
      id_token: 'id-token',
      expires_at: Math.floor(Date.now() / 1000) + 600,
      profile: {
        sub: 'user-123',
        name: 'Kitchen Operator',
        email: 'user@example.com',
      },
      state: {
        returnTo: '/app/print/new',
      },
    });

    const result = await completeAuthentication('http://localhost/auth/callback?code=test');

    expect(result.returnTo).toBe('/app/print/new');
    expect(readStoredSession()).toMatchObject({
      userId: 'user-123',
      roles: ['user'],
    });
  });
});
