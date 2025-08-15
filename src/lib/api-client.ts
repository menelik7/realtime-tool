// src/lib/api-client.ts
// -------------------------------------------------------------------------------------
// A fully-commented, SSR-safe Singleton HTTP client built on top of the Web Fetch API.
// Works in both Server Actions/Server Components and Client Components.
//
// Key ideas
// - Singleton pattern so you only create one client per runtime.
// - Smart base URL:
//     * On the server (RSC/Server Actions): uses process.env.API_BASE_URL (server-only, NOT exposed)
//     * In the browser: uses process.env.NEXT_PUBLIC_API_BASE_URL
//   If neither is set, it falls back to same-origin (your Next.js app’s domain).
// - Optional bearer auth via `setAuth()` for client-side, or via per-request headers for server-side.
// - Timeouts + retry with exponential backoff.
// - Typed responses/bodies using generics.
// - Next.js `fetch` extensions supported (revalidate/tags) when called server-side.
//
// NOTE: You do NOT need to import HeadersInit / AbortSignal / RequestInit —
//       these are built-in DOM fetch types provided by TypeScript in Next.js.
// -------------------------------------------------------------------------------------

/** Narrow the allowed HTTP verbs. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Shape for query-string params; null/undefined values will be skipped. */
type Query = Record<string, string | number | boolean | null | undefined>;

/** Simple retry configuration. */
type RetryOptions = {
  /** Total number of attempts (1 = no retries). */
  attempts?: number;
  /** Base backoff time in ms; grows exponentially per attempt. */
  backoffMs?: number;
  /** HTTP status codes that should be retried. */
  retryOn?: number[];
};

/** Options accepted by the low-level request method. */
type RequestOptions<TBody> = {
  /** Path relative to the baseUrl. Examples: '/rooms', 'rooms', '/api/rooms' */
  path: string;
  /** HTTP verb; default: 'GET' */
  method?: HttpMethod;
  /** Query string key/values appended to the URL. */
  query?: Query;
  /** Request body (JSON by default, unless you pass FormData/Blob/etc.). */
  body?: TBody;
  /** Standard fetch headers; you can pass Authorization here per request. */
  headers?: HeadersInit;
  /** Cancellation support (great in React effects). */
  signal?: AbortSignal;
  /** Hard timeout for the whole request (ms). Default: 15000. */
  timeoutMs?: number;
  /** Native fetch cache hint (e.g. 'no-store', 'force-cache'). */
  cache?: RequestCache;

  // Next.js App Router extensions to fetch — usable only on the server:
  /** Revalidation window or disable caching. */
  next?: { revalidate?: number | false; tags?: string[] };

  /** Optional retry config (defaults below). */
  retry?: RetryOptions;
};

/** Custom error so callers can catch and inspect status + parsed payload. */
export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Type guard: detect our ApiError even across module boundaries.
 *
 * Why not rely only on `instanceof`?
 * - In tests or multi-bundle scenarios, errors may cross realms, breaking `instanceof`.
 * - We therefore also check a minimal structural shape: name === "ApiError" and numeric `status`.
 */
function isApiErrorLike(err: unknown): err is ApiError {
  return (
    err instanceof ApiError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown; status?: unknown }).name === 'ApiError' &&
      typeof (err as { status?: unknown }).status === 'number')
  );
}

/**
 * Detect AbortError coming from fetch abort/timeout.
 * Abort errors are user-intent/cancellation signals and should not be retried.
 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Determine if we are running on the server at runtime.
 * Evaluated fresh each time it's called.
 */
function isServer() {
  return typeof window === 'undefined';
}

/**
 * Resolve a base URL depending on environment and runtime.
 *
 * Rules:
 * - On the server: prefer `API_BASE_URL`
 * - In the browser: prefer `NEXT_PUBLIC_API_BASE_URL`
 * - If neither is set: return empty string to mean "same-origin"
 * - Always strip trailing slashes to avoid double slashes when joining
 */
function resolveBaseUrl() {
  // Prefer server-only base URL on the server
  const serverBase = process.env.API_BASE_URL?.trim();
  // Use public base URL in the browser
  const clientBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  const chosen = (isServer() ? serverBase : clientBase) || '';
  return chosen.replace(/\/+$/, '');
}

/** Utility: detect if a value is a "body we should not JSON.stringify". */
function isMultipartLike(body: unknown): body is FormData | Blob | ArrayBufferView | ArrayBuffer {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

/**
 * Singleton HTTP client using the Fetch API.
 * Fetch and its types (RequestInit, HeadersInit, AbortSignal, etc.) are global in Next.js.
 */
class ApiClient {
  private static _instance: ApiClient;

  /** Where requests are sent, e.g. 'https://api.example.com' or ''. */
  private readonly baseUrl: string;
  /** Default headers applied to every request (can be overridden per request). */
  private defaultHeaders: HeadersInit = { 'Content-Type': 'application/json' };
  /** Optional bearer token for client-side usage. Avoid mutating this on the server. */
  private authToken: string | null = null;

  /** Private constructor ensures Singleton pattern. */
  private constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** Global instance accessor. */
  static get instance(): ApiClient {
    if (!ApiClient._instance) {
      ApiClient._instance = new ApiClient(resolveBaseUrl());
    }
    return ApiClient._instance;
  }

  /**
   * Client-side helper to set or clear a bearer token.
   * On the server, PREFER passing Authorization per request instead of mutating shared state.
   */
  setAuth(token: string | null) {
    this.authToken = token;
  }

  /**
   * Build a fully-qualified URL string by combining baseUrl + path + query.
   * - If baseUrl is '', we use same-origin:
   *     - On the client: window.location.origin
   *     - On the server: we still need an absolute base to construct a URL object,
   *       so we use 'http://localhost' (it’s not actually used to send network calls when Next routes same-origin).
   */
  private buildUrl(path: string, query?: Query) {
    const cleanedPath = path.startsWith('/') ? path : `/${path}`;

    // Choose the origin:
    const origin = this.baseUrl
      ? this.baseUrl // absolute API (your separate Node backend)
      : isServer()
        ? 'http://localhost' // server-side dummy origin for URL construction
        : window.location.origin; // browser: current origin

    const url = new URL(cleanedPath, origin);

    // Append query params, skipping null/undefined
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /** Wrap a promise with a hard timeout. */
  private withTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
    if (!ms || ms <= 0) return p;
    return new Promise<T>((resolve, reject) => {
      const id = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
      p.then((v) => {
        clearTimeout(id);
        resolve(v);
      }).catch((e) => {
        clearTimeout(id);
        reject(e);
      });
    });
  }

  /** Thin wrapper for fetch so we can keep the callsite tidy and type `next` correctly. */
  private doFetch(
    url: string,
    init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } },
  ) {
    return fetch(url, init);
  }

  /**
   * Core request method:
   * - Merges default headers and per-request headers.
   * - Adds Authorization if set via setAuth() (client-side).
   * - Handles JSON bodies and multipart bodies intelligently.
   * - Retries transient errors if configured.
   * - Throws ApiError on non-2xx with parsed payload when possible.
   */
  private async request<TResponse, TBody = unknown>({
    path,
    method = 'GET',
    query,
    body,
    headers,
    signal,
    timeoutMs = 15_000,
    cache,
    next,
    retry,
  }: RequestOptions<TBody>): Promise<TResponse> {
    const url = this.buildUrl(path, query);

    // Merge headers in the usual precedence: defaults → auth → per-request
    const mergedHeaders: HeadersInit = {
      ...this.defaultHeaders,
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...headers,
    };

    const init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } } = {
      method,
      headers: mergedHeaders,
      signal,
      cache,
      next, // only observed on the server
    };

    // Decide how to encode the body:
    // - If GET, skip a body entirely
    // - If FormData/Blob/etc., DO NOT JSON.stringify and DO NOT set Content-Type (the browser will set boundaries)
    // - Otherwise JSON-encode if Content-Type is application/json
    if (method !== 'GET' && body !== undefined) {
      if (isMultipartLike(body)) {
        // Drop content-type to let fetch set the multipart boundary
        delete (mergedHeaders as Record<string, string>)['Content-Type'];

        init.body = body as unknown as BodyInit;
      } else if ((mergedHeaders as Record<string, string>)['Content-Type'] === 'application/json') {
        init.body = JSON.stringify(body);
      } else {
        // Fallback: pass through as-is (e.g., text/plain)
        init.body = body as unknown as BodyInit;
      }
    }

    // Retry defaults
    const attempts = Math.max(1, retry?.attempts ?? 1);
    const backoffMs = retry?.backoffMs ?? 300;
    const retryOn = new Set(retry?.retryOn ?? [408, 429, 500, 502, 503, 504]);

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.withTimeout(this.doFetch(url, init), timeoutMs);

        if (!res.ok) {
          // Try to parse a useful payload
          const ct = res.headers.get('content-type') || '';
          const isJson = ct.includes('application/json');
          const data = isJson
            ? await res.json().catch(() => undefined)
            : await res.text().catch(() => undefined);
          let message: string | undefined;

          if (isJson && typeof data === 'object' && data !== null && 'message' in data) {
            const maybeMsg = (data as { message?: unknown }).message;
            message = typeof maybeMsg === 'string' ? maybeMsg : undefined;
          }

          if (!message) {
            message = typeof data === 'string' ? data : res.statusText;
          }

          // Retry on configured statuses
          if (attempt < attempts && retryOn.has(res.status)) {
            const delay = backoffMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          throw new ApiError(message || `HTTP ${res.status}`, res.status, data);
        }

        // Successful response: parse JSON when available, else text
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return (await res.json()) as TResponse;
        }
        return (await res.text()) as unknown as TResponse;
      } catch (err: unknown) {
        // Save the last error so we can throw it after all retries fail
        lastError = err;

        // Retry only for network-like errors:
        // - Do NOT retry ApiError (handled HTTP response)
        // - Do NOT retry AbortError (intentional cancellation)
        if (attempt < attempts && !isApiErrorLike(err) && !isAbortError(err)) {
          const delay = backoffMs * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue; // next attempt
        }

        // No more retries OR non-retryable error → throw immediately
        throw err;
      }
    }

    // Should be unreachable, but TypeScript appreciates a final throw.
    throw lastError instanceof Error ? lastError : new Error('Unknown API error');
  }

  // -----------------------------------------------------------------------------------
  // Convenience wrappers with friendly generics:
  // - T = response type
  // - B = body type (for non-GET)
  // -----------------------------------------------------------------------------------

  get<T>(
    path: string,
    query?: Query,
    opts?: Omit<RequestOptions<never>, 'path' | 'method' | 'query'>,
  ) {
    return this.request<T>({ path, method: 'GET', query, ...(opts ?? {}) });
  }

  post<T, B = unknown>(
    path: string,
    body?: B,
    opts?: Omit<RequestOptions<B>, 'path' | 'method' | 'body'>,
  ) {
    return this.request<T, B>({ path, method: 'POST', body, ...(opts ?? {}) });
  }

  put<T, B = unknown>(
    path: string,
    body?: B,
    opts?: Omit<RequestOptions<B>, 'path' | 'method' | 'body'>,
  ) {
    return this.request<T, B>({ path, method: 'PUT', body, ...(opts ?? {}) });
  }

  patch<T, B = unknown>(
    path: string,
    body?: B,
    opts?: Omit<RequestOptions<B>, 'path' | 'method' | 'body'>,
  ) {
    return this.request<T, B>({ path, method: 'PATCH', body, ...(opts ?? {}) });
  }

  delete<T>(path: string, opts?: Omit<RequestOptions<never>, 'path' | 'method'>) {
    return this.request<T>({ path, method: 'DELETE', ...(opts ?? {}) });
  }
}

/** Export the singleton instance used across the app. */
export const api = ApiClient.instance;

// -------------------------------------------------------------------------------------
// USAGE NOTES (quick reference)
//
// 1) Environment variables (since you’re building a separate Node backend):
//    - Server-only (NOT exposed to browser):  API_BASE_URL="https://api.your-backend.com"
//    - Browser (public):                      NEXT_PUBLIC_API_BASE_URL="https://api.your-backend.com"
//    If either is missing, we fall back to same-origin.
//
// 2) Server Action example (preferred: pass Authorization per call):
//
//    'use server'
//    import { cookies } from 'next/headers';
//    import { api } from '@/lib/api-client';
//
//    export async function getRooms() {
//      const token = cookies().get('access_token')?.value;
//      return api.get<Room[]>('/rooms', { page: 1 }, {
//        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
//        next: { revalidate: 0 }, // disable caching if you need freshest data
//        retry: { attempts: 3 },
//      });
//    }
//
// 3) Client Component example with cancellation:
//
//    'use client'
//    import { useEffect, useState } from 'react';
//    import { api } from '@/lib/api-client';
//
//    export default function RoomsList() {
//      const [rooms, setRooms] = useState<Room[]|null>(null);
//      const [error, setError] = useState<string|null>(null);
//
//    useEffect(() => {
//      const ac = new AbortController();

//     async function fetchRooms() {
//       try {
//         const rooms = await api.get<Room[]>('/rooms', { limit: 20 }, { signal: ac.signal });
//          setData(rooms);
//        } catch (e) {
//          setError(e instanceof Error ? e.message : 'Unknown error');
//        }
//      }

//       fetchRooms();

//        return () => ac.abort(); // cleanup cancels the request
//      }, []);
//
//      if (error) return <div className="text-red-600">{error}</div>;
//      if (!rooms) return <div>Loading…</div>;
//      return <ul>{rooms.map(r => <li key={r.id}>{r.name}</li>)}</ul>;
//    }
//
// 4) Uploading FormData:
//    const fd = new FormData();
//    fd.append('file', file);
//    await api.post('/upload', fd, { headers: {} }); // don’t set Content-Type
//
// 5) Handling ApiError:
//    try {
//      await api.get('/secret');
//    } catch (e) {
//      if (e instanceof ApiError) {
//        console.log(e.status, e.data);
//      }
//    }
//
// 6) Setting a bearer token on the client after login:
//    api.setAuth(accessToken); // use per-request headers instead on the server.
// -------------------------------------------------------------------------------------
