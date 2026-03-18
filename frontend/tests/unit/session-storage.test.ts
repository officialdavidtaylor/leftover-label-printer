import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_SESSION_STORAGE_KEY,
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from '../../app/lib/auth/session-storage';

describe('session-storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('writes and reads a valid session', () => {
    writeStoredSession({
      userId: 'user-1',
      accessToken: 'token-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      roles: ['user'],
      name: 'Test User',
    });

    expect(readStoredSession()).toMatchObject({
      userId: 'user-1',
      roles: ['user'],
      name: 'Test User',
    });
  });

  it('clears expired sessions during read', () => {
    window.localStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        userId: 'user-1',
        accessToken: 'token-1',
        expiresAt: 1,
        roles: ['user'],
      })
    );
    vi.setSystemTime(new Date('2026-03-18T00:00:00.000Z'));

    expect(readStoredSession()).toBeNull();
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('clears the stored session explicitly', () => {
    writeStoredSession({
      userId: 'user-1',
      accessToken: 'token-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      roles: ['user'],
    });

    clearStoredSession();

    expect(readStoredSession()).toBeNull();
  });
});
