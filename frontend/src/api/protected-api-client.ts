export class SessionExpiredError extends Error {
  constructor(message: string = 'Session expired. Please log in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export type ProtectedApiClientInput = {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
};

export type ProtectedRequestInit = RequestInit & {
  path: string;
};

export function createProtectedApiClient(input: ProtectedApiClientInput) {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async request(init: ProtectedRequestInit): Promise<Response> {
      const token = input.getAccessToken();
      if (token === null) {
        throw new SessionExpiredError();
      }

      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);

      const response = await fetchImpl(resolveUrl(input.baseUrl, init.path), {
        ...init,
        headers,
      });

      if (response.status === 401) {
        input.onUnauthorized?.();
        throw new SessionExpiredError();
      }

      return response;
    },
  };
}

function resolveUrl(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
