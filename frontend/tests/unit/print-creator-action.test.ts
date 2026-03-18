import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPrintJob, requireAuthenticatedSession, signOutLocally } = vi.hoisted(() => ({
  createPrintJob: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  signOutLocally: vi.fn(),
}));

vi.mock('../../app/lib/api/print-jobs.client', () => ({
  createPrintJob,
}));

vi.mock('../../app/lib/auth/oidc-client', () => ({
  signOutLocally,
}));

vi.mock('../../app/lib/auth/route-guards', () => ({
  requireAuthenticatedSession,
  getReturnToFromUrl: (inputUrl: string) => {
    const url = new URL(inputUrl);
    return `${url.pathname}${url.search}${url.hash}`;
  },
}));

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

import { clientAction } from '../../app/routes/app.print.new';
import { ApiError } from '../../app/lib/api/http-client';

describe('print creator clientAction', () => {
  beforeEach(() => {
    createPrintJob.mockReset();
    requireAuthenticatedSession.mockReset();
    signOutLocally.mockReset();
    requireAuthenticatedSession.mockReturnValue({
      accessToken: 'access-token',
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
  });

  it('shapes a valid request payload for the existing API contract', async () => {
    createPrintJob.mockResolvedValue({
      jobId: 'job-1',
      state: 'pending',
      acceptedAt: '2026-03-18T17:00:00.000Z',
      traceId: 'trace-1',
    });

    const result = await clientAction({
      request: new Request('http://localhost/app/print/new', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          itemName: 'Chicken soup',
          datePrepared: '2026-03-18',
        }),
      }),
    });

    expect(createPrintJob).toHaveBeenCalledWith('access-token', {
      idempotencyKey: 'frontend-11111111-1111-4111-8111-111111111111',
      printerId: 'printer-1',
      templateId: 'label-default',
      templateVersion: 'v1',
      payload: {
        itemName: 'Chicken soup',
        datePrepared: '2026-03-18',
      },
    });
    expect(result).toEqual({
      ok: true,
      jobId: 'job-1',
      state: 'pending',
    });
  });

  it('short-circuits malformed form payloads before hitting the API', async () => {
    const result = await clientAction({
      request: new Request('http://localhost/app/print/new', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          itemName: '',
          datePrepared: '03/18/2026',
        }),
      }),
    });

    expect(createPrintJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: 'form_validation_error',
      message: 'Check the highlighted fields and try again.',
    });
  });

  it('clears the local session and redirects to login on auth failures', async () => {
    createPrintJob.mockRejectedValue(
      new ApiError(401, {
        code: 'unauthorized',
        message: 'Token expired.',
      })
    );

    try {
      await clientAction({
        request: new Request('http://localhost/app/print/new?source=pwa', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            itemName: 'Chicken soup',
            datePrepared: '2026-03-18',
          }),
        }),
      });
      throw new Error('expected auth redirect');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/login?returnTo=%2Fapp%2Fprint%2Fnew%3Fsource%3Dpwa');
    }

    expect(signOutLocally).toHaveBeenCalledTimes(1);
  });
});
