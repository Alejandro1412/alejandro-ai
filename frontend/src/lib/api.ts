/**
 * Typed API client. Access tokens live only in memory (never localStorage); the refresh token is an
 * httpOnly cookie handled by the browser. A 401 triggers one single-flight refresh and a retry.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type Listener = (token: string | null) => void;
let accessToken: string | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get: () => accessToken,
  set(token: string | null) {
    accessToken = token;
    listeners.forEach((l) => l(token));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

let refreshing: Promise<string | null> | null = null;

export function refreshSession(): Promise<string | null> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return null;
      const body = (await r.json()) as { data: { accessToken: string } };
      return body.data.accessToken;
    })
    .catch(() => null)
    .then((t) => {
      tokenStore.set(t);
      return t;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip auth refresh logic (login/register). */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.pathname + url.search;
}

async function raw<T>(path: string, opts: RequestOptions, retried = false): Promise<{ data: T; meta?: PageMeta }> {
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (!isForm && opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      signal: opts.signal,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'No connection to the server');
  }
  if (res.status === 401 && !opts.anonymous && !retried) {
    const token = await refreshSession();
    if (token) return raw<T>(path, opts, true);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as { success: boolean; data?: T; meta?: PageMeta; error?: { code: string; message: string; details?: Record<string, unknown> } }) : null;
  if (!res.ok || !body?.success) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? res.statusText, e?.details ?? {});
  }
  return { data: body.data as T, meta: body.meta };
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => raw<T>(path, { query, signal }).then((r) => r.data),
  page: <T>(path: string, query?: RequestOptions['query']) => raw<T[]>(path, { query }).then((r) => ({ items: r.data, meta: r.meta! })),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) => raw<T>(path, { ...opts, method: 'POST', body: body ?? {} }).then((r) => r.data),
  patch: <T>(path: string, body: unknown) => raw<T>(path, { method: 'PATCH', body }).then((r) => r.data),
  put: <T>(path: string, body: unknown) => raw<T>(path, { method: 'PUT', body }).then((r) => r.data),
  delete: <T>(path: string) => raw<T>(path, { method: 'DELETE' }).then((r) => r.data),
  upload: <T>(path: string, form: FormData) => raw<T>(path, { method: 'POST', body: form }).then((r) => r.data),
  request: raw,
};

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: { path: string; message: string }[] }).issues;
    if (issues?.length) return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ');
    return err.message;
  }
  return fallback;
}
