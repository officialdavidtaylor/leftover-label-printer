import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { ApiError, requestJson } from '../../app/lib/api/http-client';
import { printJobAcceptedResponseSchema } from '../../app/lib/schemas/print-jobs';

describe('requestJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates a successful JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            jobId: 'job-1',
            state: 'pending',
            acceptedAt: '2026-03-18T17:00:00.000Z',
          }),
          {
            status: 202,
            headers: {
              'content-type': 'application/json',
            },
          }
        )
      )
    );

    await expect(
      requestJson({
        path: '/v1/print-jobs',
        method: 'POST',
        accessToken: 'access-token',
        expectedStatus: 202,
        schema: printJobAcceptedResponseSchema,
      })
    ).resolves.toMatchObject({
      jobId: 'job-1',
      state: 'pending',
    });
  });

  it('throws ApiError for structured backend failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'forbidden',
            message: 'Forbidden',
            traceId: 'trace-1',
          }),
          {
            status: 403,
            headers: {
              'content-type': 'application/json',
            },
          }
        )
      )
    );

    await expect(
      requestJson({
        path: '/v1/print-jobs',
        method: 'POST',
        accessToken: 'access-token',
        expectedStatus: 202,
        schema: printJobAcceptedResponseSchema,
      })
    ).rejects.toBeInstanceOf(ApiError);
  });
});
