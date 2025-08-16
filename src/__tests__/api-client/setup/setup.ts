/**
 * Global beforeEach for all api-client tests.
 * Ensures clean state and no leakage between test runs.
 */
import { beforeEach, vi } from 'vitest';
import { fetchMock } from './helpers';
import { api } from '@/lib/api-client'; // The singleton client

beforeEach(() => {
  // Restore all mocks between tests
  vi.restoreAllMocks();

  // Replace global fetch with our mock
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();

  // Ensure no env base URLs leak into tests; exercise same-origin fallback
  delete process.env.API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;

  // Clear any authentication token set by prior tests
  api.setAuth(null);

  // Remove any mocked window from earlier tests to avoid cross-test leakage
  // (Individual tests can set globalThis.window when needed.)
  // @ts-expect-error – test-only global cleanup
  delete globalThis.window;
});
