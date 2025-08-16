/**
 * Helpers for api-client unit tests.
 * These can be imported across multiple test files.
 */

import { vi } from 'vitest';

// Global fetch mock instance – shared by all tests
export const fetchMock = vi.fn();

/**
 * Helper to create a mock Response object.
 * If content-type includes 'json', the body will be JSON-stringified.
 */
export const makeRes = (status: number, body: unknown, contentType = 'application/json') =>
  new Response(contentType.includes('json') ? JSON.stringify(body) : (body as string), {
    status,
    headers: { 'content-type': contentType },
  });
