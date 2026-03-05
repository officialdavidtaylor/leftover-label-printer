import { describe, expect, it, vi } from 'vitest';

import { createProtectedApiClient, SessionExpiredError } from '../../frontend/src/api/protected-api-client.ts';

describe('protected-api-client', () => {
  it('adds bearer token to protected requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer token-123');

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });

    const client = createProtectedApiClient({
      baseUrl: 'http://localhost:8080',
      getAccessToken: () => 'token-123',
      fetchImpl,
    });

    const response = await client.request({
      path: '/v1/print-jobs/job-1',
      method: 'GET',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it('throws session expired when no access token is available', async () => {
    const client = createProtectedApiClient({
      baseUrl: 'http://localhost:8080',
      getAccessToken: () => null,
      fetchImpl: vi.fn(),
    });

    await expect(
      client.request({
        path: '/v1/print-jobs/job-1',
        method: 'GET',
      })
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('clears session on 401 responses', async () => {
    const onUnauthorized = vi.fn();

    const client = createProtectedApiClient({
      baseUrl: 'http://localhost:8080',
      getAccessToken: () => 'token-123',
      onUnauthorized,
      fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
    });

    await expect(
      client.request({
        path: '/v1/print-jobs/job-1',
        method: 'GET',
      })
    ).rejects.toBeInstanceOf(SessionExpiredError);

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
