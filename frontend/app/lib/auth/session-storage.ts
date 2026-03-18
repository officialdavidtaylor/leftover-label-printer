import { authSessionSchema, isSessionExpired, type AuthSession } from '../schemas/auth';

export const AUTH_SESSION_STORAGE_KEY = 'leftover-label-printer.auth-session';

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function readStoredSession(): AuthSession | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = authSessionSchema.parse(JSON.parse(raw));
    if (isSessionExpired(parsed)) {
      storage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    storage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return null;
  }
}

export function writeStoredSession(session: AuthSession): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  const storage = getLocalStorage();
  storage?.removeItem(AUTH_SESSION_STORAGE_KEY);
}
