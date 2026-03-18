import type { ZodType } from 'zod';

import { getFrontendEnv } from '../env';
import { errorResponseSchema, type ErrorResponse } from '../schemas/print-jobs';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly traceId?: string;

  constructor(status: number, response: ErrorResponse) {
    super(response.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = response.code;
    this.traceId = response.traceId;
  }
}

function buildUrl(path: string): string {
  const { apiBaseUrl } = getFrontendEnv();
  const normalizedBase = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  if (normalizedBase.startsWith('http://') || normalizedBase.startsWith('https://')) {
    return `${normalizedBase}${path}`;
  }

  return `${normalizedBase}${path}`;
}

export async function requestJson<T>(input: {
  path: string;
  method?: 'GET' | 'POST';
  accessToken: string;
  body?: unknown;
  schema: ZodType<T>;
  expectedStatus: number;
}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(buildUrl(input.path), {
      method: input.method ?? 'GET',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        ...(input.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    });
  } catch {
    throw new ApiError(0, {
      code: 'network_error',
      message: 'Unable to reach the API.',
    });
  }

  const responseBody = (await response.json().catch(() => ({}))) as unknown;

  if (response.status !== input.expectedStatus) {
    const parsedError = errorResponseSchema.safeParse(responseBody);
    if (parsedError.success) {
      throw new ApiError(response.status, parsedError.data);
    }

    throw new ApiError(response.status, {
      code: 'unexpected_error',
      message: 'Unexpected API response.',
    });
  }

  return input.schema.parse(responseBody);
}
