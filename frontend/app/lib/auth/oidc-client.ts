import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

import { authHydrated, authSignedOut } from '../../features/auth/auth.duck';
import { store } from '../../store';
import { getFrontendEnv } from '../env';
import { authSessionSchema, type AuthSession } from '../schemas/auth';
import { clearStoredSession, writeStoredSession } from './session-storage';

let userManager: UserManager | null = null;

type TokenPayload = {
  roles?: unknown;
  realm_access?: {
    roles?: unknown;
  };
  resource_access?: Record<string, { roles?: unknown }>;
};
function getUserManager(): UserManager {
  if (userManager) {
    return userManager;
  }

  const env = getFrontendEnv();
  userManager = new UserManager({
    authority: env.oidcIssuerUrl,
    client_id: env.oidcClientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    response_type: env.oidcResponseType,
    scope: 'openid profile email',
    loadUserInfo: false,
    automaticSilentRenew: false,
    monitorSession: false,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    extraQueryParams: {
      audience: env.oidcAudience,
    },
  });

  return userManager;
}

function toRoleList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((role): role is string => typeof role === 'string' && role.trim().length > 0);
}

function decodeJwtPayload(token: string): TokenPayload | null {
  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }

  try {
    const encodedPayload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const json = window.atob(paddedPayload);

    return JSON.parse(json) as TokenPayload;
  } catch {
    return null;
  }
}

function extractRolesFromPayload(payload: TokenPayload | null): string[] {
  if (!payload) {
    return [];
  }

  const resourceRoles = Object.values(payload.resource_access ?? {}).flatMap((resource) => toRoleList(resource?.roles));

  return [...toRoleList(payload.roles), ...toRoleList(payload.realm_access?.roles), ...resourceRoles];
}

function normalizeUser(user: User): AuthSession {
  const profilePayload = user.profile as TokenPayload;
  const accessTokenPayload = decodeJwtPayload(user.access_token);
  const roles = Array.from(new Set([...extractRolesFromPayload(profilePayload), ...extractRolesFromPayload(accessTokenPayload)]));

  return authSessionSchema.parse({
    userId: user.profile.sub,
    accessToken: user.access_token,
    idToken: user.id_token ?? undefined,
    expiresAt: user.expires_at ?? Math.floor(Date.now() / 1000) + 300,
    roles,
    name: typeof user.profile.name === 'string' ? user.profile.name : undefined,
    email: typeof user.profile.email === 'string' ? user.profile.email : undefined,
  });
}

export async function startAuthentication(returnTo: string): Promise<never> {
  const manager = getUserManager();
  await manager.clearStaleState();
  await manager.signinRedirect({
    state: {
      returnTo,
    },
  });

  throw new Error('OIDC redirect did not leave the page');
}

export async function completeAuthentication(currentUrl: string): Promise<{ session: AuthSession; returnTo: string }> {
  const manager = getUserManager();
  const user = await manager.signinRedirectCallback(currentUrl);
  const session = normalizeUser(user);

  writeStoredSession(session);
  store.dispatch(authHydrated(session));

  const returnTo =
    typeof user.state === 'object' &&
    user.state !== null &&
    'returnTo' in user.state &&
    typeof user.state.returnTo === 'string' &&
    user.state.returnTo.startsWith('/')
      ? user.state.returnTo
      : '/app/print/new';

  return { session, returnTo };
}

export async function signOutLocally(): Promise<void> {
  clearStoredSession();
  store.dispatch(authSignedOut());
  if (userManager) {
    await userManager.removeUser();
  }
}

export function resetOidcClient(): void {
  userManager = null;
}
