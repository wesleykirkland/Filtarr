const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let cachedCsrfToken: string | null = null;
let csrfTokenPromise: Promise<string | null> | null = null;

async function getCsrfToken(): Promise<string | null> {
  if (cachedCsrfToken) return cachedCsrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = fetch(`${BASE}/auth/csrf`, { method: 'GET' })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { csrfToken?: string | null } | null;
      return body?.csrfToken ?? null;
    })
    .then((token) => {
      cachedCsrfToken = token;
      return token;
    })
    .finally(() => {
      csrfTokenPromise = null;
    });

  return csrfTokenPromise;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const needsCsrf = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (options?.headers) {
    // Normalize HeadersInit (object/array/Headers) into our mutable Headers instance.
    new Headers(options.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  if (needsCsrf && !headers.has('X-CSRF-Token') && !headers.has('x-csrf-token')) {
    const token = await getCsrfToken();
    if (token) headers.set('X-CSRF-Token', token);
  }

  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      ...options,
      // Ensure our merged headers are not overwritten by options.headers.
      headers,
    });

  let res = await doFetch();
  if (res.status === 403 && needsCsrf) {
    // Token may have rotated or cookie may have been cleared. Refresh once and retry.
    cachedCsrfToken = null;
    const token = await getCsrfToken();
    if (token) headers.set('X-CSRF-Token', token);
    res = await doFetch();
  }

  if (!res.ok) {
    if (res.status === 401) {
      globalThis.dispatchEvent(new Event('auth:401'));
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error?.message || body.error || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
