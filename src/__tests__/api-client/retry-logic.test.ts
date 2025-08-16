/**
 * Tests for retry behavior on transient and non-transient failures.
 */
import { describe, it, expect } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { fetchMock, makeRes } from './setup/helpers';
import './setup/setup';

describe('Retry logic', () => {
  it('retries transient errors (e.g., 500) and succeeds on second try', async () => {
    fetchMock
      .mockResolvedValueOnce(makeRes(500, { error: 'server busy' }))
      .mockResolvedValueOnce(makeRes(200, { ok: true }));

    const res = await api.get('/sometimes-works', undefined, { retry: { attempts: 2 } });
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable status (e.g., 404)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(404, { error: 'nope' }));

    let err: unknown;
    try {
      await api.get('/never-retry', undefined, { retry: { attempts: 2 } });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on a network error (rejection) and then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeRes(200, { ok: true }));

    const res = await api.get('/eventual-success', undefined, { retry: { attempts: 2 } });
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
