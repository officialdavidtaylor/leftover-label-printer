import { describe, expect, it, vi } from 'vitest';

import { AuthSessionManager, OidcCallbackError } from '../../frontend/src/auth/auth-session-manager.ts';
import { type FrontendOidcConfig } from '../../frontend/src/auth/oidc-config.ts';
import { MemoryStorage } from './helpers/memory-storage.ts';

const oidcConfig: FrontendOidcConfig = {
  apiBaseUrl: 'http://localhost:8080',
  issuerUrl: 'http://localhost:9000/application/o/leftover-label-printer/',
  clientId: 'leftover-label-printer-pwa',
  audience: 'leftover-label-printer-api',
  responseType: 'code',
  pkceRequired: true,
  scope: 'openid profile email',
};

describe('auth-session-manager', () => {
  it('creates authorization URL and stores PKCE transient values', async () => {
    const transientStorage = new MemoryStorage();
    const persistentStorage = new MemoryStorage();

    const manager = new AuthSessionManager(oidcConfig, {
      transientStorage,
      persistentStorage,
      createState: () => 'state-123',
      createCodeVerifier: () => 'verifier-123',
    });

    const redirectUrl = await manager.createLoginRedirectUrl({
      redirectUri: 'http://localhost:3000/auth/callback',
    });

    const parsedUrl = new URL(redirectUrl);
    expect(parsedUrl.pathname).toContain('/authorize');
    expect(parsedUrl.searchParams.get('state')).toBe('state-123');
    expect(parsedUrl.searchParams.get('response_type')).toBe('code');
    expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('completes callback, exchanges code, and persists session token', async () => {
    const transientStorage = new MemoryStorage();
    const persistentStorage = new MemoryStorage();

    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      const params = body as URLSearchParams;
      expect(params.get('code')).toBe('auth-code-1');
      expect(params.get('code_verifier')).toBe('verifier-123');

      return new Response(
        JSON.stringify({
          access_token: 'token-abc',
          token_type: 'Bearer',
          expires_in: 60,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    });

    const manager = new AuthSessionManager(oidcConfig, {
      transientStorage,
      persistentStorage,
      fetchImpl,
      createState: () => 'state-123',
      createCodeVerifier: () => 'verifier-123',
      nowMs: () => 1_000,
    });

    await manager.createLoginRedirectUrl({
      redirectUri: 'http://localhost:3000/auth/callback',
    });

    const session = await manager.completeLoginFromCallback({
      callbackUrl: 'http://localhost:3000/auth/callback?code=auth-code-1&state=state-123',
      redirectUri: 'http://localhost:3000/auth/callback',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(session.accessToken).toBe('token-abc');
    expect(session.expiresAtEpochMs).toBe(61_000);
    expect(manager.readAccessToken()).toBe('token-abc');
  });

  it('rejects callback with state mismatch', async () => {
    const transientStorage = new MemoryStorage();
    const manager = new AuthSessionManager(oidcConfig, {
      transientStorage,
      persistentStorage: new MemoryStorage(),
      createState: () => 'expected-state',
      createCodeVerifier: () => 'verifier-123',
    });

    await manager.createLoginRedirectUrl({
      redirectUri: 'http://localhost:3000/auth/callback',
    });

    await expect(
      manager.completeLoginFromCallback({
        callbackUrl: 'http://localhost:3000/auth/callback?code=auth-code-1&state=bad-state',
        redirectUri: 'http://localhost:3000/auth/callback',
      })
    ).rejects.toBeInstanceOf(OidcCallbackError);

    expect(transientStorage.getItem('leftover-label-printer.oidc.pkce.state')).toBeNull();
    expect(transientStorage.getItem('leftover-label-printer.oidc.pkce.verifier')).toBeNull();
  });

  it('clears session once token is expired', async () => {
    const transientStorage = new MemoryStorage();
    const persistentStorage = new MemoryStorage();

    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'token-short',
          token_type: 'Bearer',
          expires_in: 1,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    });

    let nowMs = 1_000;

    const manager = new AuthSessionManager(oidcConfig, {
      transientStorage,
      persistentStorage,
      fetchImpl,
      createState: () => 'state-123',
      createCodeVerifier: () => 'verifier-123',
      nowMs: () => nowMs,
    });

    await manager.createLoginRedirectUrl({
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    await manager.completeLoginFromCallback({
      callbackUrl: 'http://localhost:3000/auth/callback?code=auth-code-1&state=state-123',
      redirectUri: 'http://localhost:3000/auth/callback',
    });

    expect(manager.readAccessToken()).toBe('token-short');

    nowMs = 2_500;
    expect(manager.readAccessToken()).toBeNull();
  });

  it('clears session and returns provider logout URL', () => {
    const manager = new AuthSessionManager(oidcConfig, {
      transientStorage: new MemoryStorage(),
      persistentStorage: new MemoryStorage(),
      createState: () => 'state-123',
      createCodeVerifier: () => 'verifier-123',
    });

    const logoutUrl = manager.createLogoutRedirectUrl({
      postLogoutRedirectUri: 'http://localhost:3000',
    });

    const parsedLogoutUrl = new URL(logoutUrl);
    expect(parsedLogoutUrl.pathname).toContain('/end-session');
    expect(parsedLogoutUrl.searchParams.get('client_id')).toBe('leftover-label-printer-pwa');
    expect(parsedLogoutUrl.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3000');
    expect(manager.readAccessToken()).toBeNull();
  });
});
