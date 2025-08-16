/**
 * Tests for hard timeouts and AbortError handling.
 */
import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchMock } from './setup/helpers';
import './setup/setup';

describe('Timeout & abort behavior', () => {
  it('aborts on hard timeout and rejects with a timeout error', async () => {
    // Mock a fetch that never resolves (simulates a hung request)
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(() => {
          /* never */
        }),
    );

    const timeoutMs = 25; // Make it quick for the test
    const err = await api.get('/hangs', undefined, { timeoutMs }).then(
      () => null,
      (e) => e as Error,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe(`Request timed out after ${timeoutMs}ms`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when fetch rejects with AbortError', async () => {
    // Create an AbortError-like object without using `any`
    const abortErr = new Error('aborted');
    Object.defineProperty(abortErr, 'name', { value: 'AbortError' });

    fetchMock.mockRejectedValueOnce(abortErr);

    const err = await api.get('/aborted', undefined, { retry: { attempts: 2 } }).then(
      () => null,
      (e) => e as Error,
    );

    // Should fail immediately, and not retry
    expect(err).toBeInstanceOf(Error);
    expect(err?.name).toBe('AbortError');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
