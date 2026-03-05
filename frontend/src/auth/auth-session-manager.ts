import { createAuthorizationUrl, createPkceCodeChallenge, createRandomCodeVerifier, createRandomState, exchangeAuthorizationCode, type TokenEndpointResponse } from './pkce.js';
import { type FrontendOidcConfig } from './oidc-config.js';
import { SessionStore, type AuthSession, type StorageLike } from './session-store.js';

const PKCE_STATE_STORAGE_KEY = 'leftover-label-printer.oidc.pkce.state';
const PKCE_VERIFIER_STORAGE_KEY = 'leftover-label-printer.oidc.pkce.verifier';

export class OidcCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcCallbackError';
  }
}

export type AuthSessionManagerDependencies = {
  fetchImpl?: typeof fetch;
  transientStorage: StorageLike;
  persistentStorage: StorageLike;
  nowMs?: () => number;
  createState?: () => string;
  createCodeVerifier?: () => string;
};

export class AuthSessionManager {
  private readonly sessionStore: SessionStore;
  private readonly nowMs: () => number;
  private readonly createState: () => string;
  private readonly createCodeVerifier: () => string;

  constructor(
    private readonly config: FrontendOidcConfig,
    private readonly dependencies: AuthSessionManagerDependencies
  ) {
    this.sessionStore = new SessionStore(dependencies.persistentStorage);
    this.nowMs = dependencies.nowMs ?? (() => Date.now());
    this.createState = dependencies.createState ?? (() => createRandomState());
    this.createCodeVerifier = dependencies.createCodeVerifier ?? (() => createRandomCodeVerifier());
  }

  readActiveSession(): AuthSession | null {
    return this.sessionStore.read(this.nowMs());
  }

  readAccessToken(): string | null {
    const session = this.readActiveSession();
    return session?.accessToken ?? null;
  }

  async createLoginRedirectUrl(input: { redirectUri: string }): Promise<string> {
    this.clearTransientPkceState();

    const state = this.createState();
    const codeVerifier = this.createCodeVerifier();
    const codeChallenge = await createPkceCodeChallenge(codeVerifier);

    this.dependencies.transientStorage.setItem(PKCE_STATE_STORAGE_KEY, state);
    this.dependencies.transientStorage.setItem(PKCE_VERIFIER_STORAGE_KEY, codeVerifier);

    return createAuthorizationUrl({
      issuerUrl: this.config.issuerUrl,
      clientId: this.config.clientId,
      redirectUri: input.redirectUri,
      audience: this.config.audience,
      scope: this.config.scope,
      state,
      codeChallenge,
    });
  }

  async completeLoginFromCallback(input: { callbackUrl: string; redirectUri: string }): Promise<AuthSession> {
    try {
      const callback = new URL(input.callbackUrl);
      const callbackError = callback.searchParams.get('error');
      if (callbackError !== null) {
        throw new OidcCallbackError(`OIDC callback error: ${callbackError}`);
      }

      const state = callback.searchParams.get('state');
      const code = callback.searchParams.get('code');

      if (state === null || code === null) {
        throw new OidcCallbackError('OIDC callback is missing state or code');
      }

      const expectedState = this.dependencies.transientStorage.getItem(PKCE_STATE_STORAGE_KEY);
      const codeVerifier = this.dependencies.transientStorage.getItem(PKCE_VERIFIER_STORAGE_KEY);

      if (expectedState === null || codeVerifier === null) {
        throw new OidcCallbackError('OIDC callback state is missing from transient storage');
      }

      if (expectedState !== state) {
        throw new OidcCallbackError('OIDC callback state mismatch');
      }

      const tokenResponse: TokenEndpointResponse = await exchangeAuthorizationCode({
        issuerUrl: this.config.issuerUrl,
        clientId: this.config.clientId,
        redirectUri: input.redirectUri,
        code,
        codeVerifier,
        fetchImpl: this.dependencies.fetchImpl,
      });

      return this.sessionStore.save({
        accessToken: tokenResponse.accessToken,
        tokenType: tokenResponse.tokenType,
        expiresInSeconds: tokenResponse.expiresInSeconds,
        nowMs: this.nowMs(),
      });
    } finally {
      this.clearTransientPkceState();
    }
  }

  createLogoutRedirectUrl(input: { postLogoutRedirectUri: string }): string {
    this.sessionStore.clear();
    this.clearTransientPkceState();

    const logoutUrl = new URL('end-session', ensureTrailingSlash(this.config.issuerUrl));
    logoutUrl.searchParams.set('client_id', this.config.clientId);
    logoutUrl.searchParams.set('post_logout_redirect_uri', input.postLogoutRedirectUri);

    return logoutUrl.toString();
  }

  clearSession(): void {
    this.sessionStore.clear();
    this.clearTransientPkceState();
  }

  private clearTransientPkceState(): void {
    this.dependencies.transientStorage.removeItem(PKCE_STATE_STORAGE_KEY);
    this.dependencies.transientStorage.removeItem(PKCE_VERIFIER_STORAGE_KEY);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
