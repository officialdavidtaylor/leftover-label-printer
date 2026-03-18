import { beforeEach, describe, expect, it } from 'vitest';

import {
  getReturnToFromUrl,
  redirectAuthenticatedUsers,
  requireAuthenticatedSession,
} from '../../app/lib/auth/route-guards';
import { writeStoredSession } from '../../app/lib/auth/session-storage';

describe('route-guards', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds a safe returnTo value for protected routes', () => {
    expect(getReturnToFromUrl('http://localhost/app/print/new?from=pwa')).toBe('/app/print/new?from=pwa');
    expect(getReturnToFromUrl('http://localhost/login')).toBe('/app/print/new');
  });

  it('redirects unauthenticated users to login', () => {
    try {
      requireAuthenticatedSession('http://localhost/app/print/new?source=home');
      throw new Error('expected a redirect');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.headers.get('Location')).toBe('/login?returnTo=%2Fapp%2Fprint%2Fnew%3Fsource%3Dhome');
    }
  });

  it('returns the stored session when available', () => {
    writeStoredSession({
      userId: 'user-2',
      accessToken: 'token-2',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      roles: ['user'],
    });

    expect(requireAuthenticatedSession('http://localhost/app/print/new')).toMatchObject({
      userId: 'user-2',
    });
  });

  it('redirects authenticated users away from login', () => {
    writeStoredSession({
      userId: 'user-2',
      accessToken: 'token-2',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      roles: ['user'],
    });

    try {
      redirectAuthenticatedUsers('http://localhost/login?returnTo=%2Fapp%2Fjobs%2Fjob-1');
      throw new Error('expected redirect');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.headers.get('Location')).toBe('/app/jobs/job-1');
    }
  });
});
