/**
 * Env-driven base URL resolution tests.
 *
 * IMPORTANT: This file does NOT import the shared setup because we must
 * instantiate a FRESH api-client singleton per test (base URL is captured
 * at import time). We control:
 *   1) env vars (API_BASE_URL / NEXT_PUBLIC_API_BASE_URL)
 *   2) window presence (server vs browser)
 *   3) fetch mocking
 *
 * We use `vi.resetModules()` and then `await import('@/lib/api-client')`
 * AFTER setting env/window to ensure the singleton reads the intended config.
 */

import { describe, it, beforeEach, expect, vi } from 'vitest';
import { fetchMock, makeRes } from './setup/helpers';

// Local per-file setup (not using the global shared setup)
beforeEach(() => {
  // Clean all mocks/stubs
  vi.restoreAllMocks();
  fetchMock.mockReset();

  // Fresh fetch stub each test
  vi.stubGlobal('fetch', fetchMock);

  // Start each test with no env so we control exactly what’s set
  delete process.env.API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;

  // Remove any mocked window from earlier tests to avoid cross-test leakage
  // (Individual tests can set globalThis.window when needed.)
  // @ts-expect-error – test-only global cleanup
  delete globalThis.window;

  // Reset the module registry so the api-client singleton re-initializes
  vi.resetModules();
});

describe('Base URL (env-driven)', () => {
  it('uses API_BASE_URL on the server (no window)', async () => {
    // Simulate server runtime by ensuring window is undefined
    // (We already deleted it in beforeEach.)

    // Set ONLY the server env var
    process.env.API_BASE_URL = 'https://api.example.com';

    // Import AFTER setting env; this constructs a fresh singleton using these vars
    const { api } = await import('@/lib/api-client');

    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.get('/health');

    const [urlArg] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toBe('https://api.example.com/health');
  });

  it('uses NEXT_PUBLIC_API_BASE_URL in the browser when set', async () => {
    // Simulate a browser environment (window present)
    const fakeWindow: Pick<Window, 'location'> = {
      location: { origin: 'https://app.example.com' } as Location,
    };
    globalThis.window = fakeWindow as Window & typeof globalThis;

    // Set ONLY the public env var (browser)
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://public.example.com';

    // Import AFTER setting env + window
    const { api } = await import('@/lib/api-client');

    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.get('/ping');

    const [urlArg] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toBe('https://public.example.com/ping');
  });
});
