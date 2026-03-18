import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPrintJob, redirectToLogin, requireAuthenticatedSession, signOutLocally } = vi.hoisted(() => ({
  getPrintJob: vi.fn(),
  redirectToLogin: vi.fn(),
  requireAuthenticatedSession: vi.fn(),
  signOutLocally: vi.fn(),
}));

vi.mock('../../app/lib/api/print-jobs.client', () => ({
  getPrintJob,
}));

vi.mock('../../app/lib/auth/oidc-client', () => ({
  signOutLocally,
}));

vi.mock('../../app/lib/auth/route-guards', () => ({
  redirectToLogin,
  requireAuthenticatedSession,
}));

import { ApiError } from '../../app/lib/api/http-client';
import { clientLoader } from '../../app/routes/app.jobs.$jobId';

describe('job status clientLoader', () => {
  beforeEach(() => {
    getPrintJob.mockReset();
    redirectToLogin.mockReset();
    requireAuthenticatedSession.mockReset();
    signOutLocally.mockReset();
    requireAuthenticatedSession.mockReturnValue({
      accessToken: 'access-token',
    });
    redirectToLogin.mockImplementation((inputUrl: string) => {
      // React Router loaders/actions use thrown Response objects for redirects.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw new Response(null, {
        status: 302,
        headers: {
          Location: `/login?returnTo=${encodeURIComponent(new URL(inputUrl).pathname + new URL(inputUrl).search)}`,
        },
      });
    });
  });

  it('returns the job status when the API call succeeds', async () => {
    getPrintJob.mockResolvedValue({
      jobId: 'job-1',
      state: 'pending',
      printerId: 'printer-1',
      templateId: 'label-default',
      templateVersion: 'v1',
      events: [],
    });

    const result = await clientLoader({
      request: new Request('http://localhost/app/jobs/job-1'),
      params: {
        jobId: 'job-1',
      },
    });

    expect(getPrintJob).toHaveBeenCalledWith('access-token', 'job-1');
    expect(result).toEqual({
      ok: true,
      job: {
        jobId: 'job-1',
        state: 'pending',
        printerId: 'printer-1',
        templateId: 'label-default',
        templateVersion: 'v1',
        events: [],
      },
    });
  });

  it('clears the local session and redirects to login on auth failures', async () => {
    getPrintJob.mockRejectedValue(
      new ApiError(403, {
        code: 'forbidden',
        message: 'Missing canonical roles.',
      })
    );

    try {
      await clientLoader({
        request: new Request('http://localhost/app/jobs/job-1?source=toast'),
        params: {
          jobId: 'job-1',
        },
      });
      throw new Error('expected auth redirect');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/login?returnTo=%2Fapp%2Fjobs%2Fjob-1%3Fsource%3Dtoast');
    }

    expect(signOutLocally).toHaveBeenCalledTimes(1);
    expect(redirectToLogin).toHaveBeenCalledWith('http://localhost/app/jobs/job-1?source=toast');
  });
});
