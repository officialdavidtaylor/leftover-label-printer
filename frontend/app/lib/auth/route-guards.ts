import { redirect } from 'react-router';

import { authHydrated, authSignedOut } from '../../features/auth/auth.duck';
import { store } from '../../store';
import type { AuthSession } from '../schemas/auth';
import { clearStoredSession, readStoredSession } from './session-storage';

const DEFAULT_AUTHENTICATED_ROUTE = '/app/print/new';

function normalizeReturnTo(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return DEFAULT_AUTHENTICATED_ROUTE;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue.startsWith('/') || trimmedValue.startsWith('//')) {
    return DEFAULT_AUTHENTICATED_ROUTE;
  }

  if (trimmedValue.startsWith('/login') || trimmedValue.startsWith('/auth/callback')) {
    return DEFAULT_AUTHENTICATED_ROUTE;
  }

  return trimmedValue;
}

function buildLoginRedirect(returnTo: string) {
  const params = new URLSearchParams({
    returnTo,
  });

  return redirect(`/login?${params.toString()}`);
}

export function getReturnToFromUrl(inputUrl: string): string {
  const url = new URL(inputUrl, 'http://localhost');
  const value = `${url.pathname}${url.search}${url.hash}`;

  return normalizeReturnTo(value);
}

export function hydrateAuthFromStorage(): AuthSession | null {
  const session = readStoredSession();

  if (session) {
    store.dispatch(authHydrated(session));
    return session;
  }

  clearStoredSession();
  store.dispatch(authSignedOut());
  return null;
}

export function requireAuthenticatedSession(inputUrl: string): AuthSession {
  const session = hydrateAuthFromStorage();
  if (!session) {
    // React Router loaders/actions use thrown Response objects for redirects.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw buildLoginRedirect(getReturnToFromUrl(inputUrl));
  }

  return session;
}

export function redirectAuthenticatedUsers(inputUrl: string): never | null {
  const session = hydrateAuthFromStorage();
  if (!session) {
    return null;
  }

  const url = new URL(inputUrl, 'http://localhost');
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));
  // React Router loaders/actions use thrown Response objects for redirects.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw redirect(returnTo);
}
