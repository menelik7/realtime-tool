/**
 * Tests for error parsing and ApiError behavior.
 */
import { describe, it, expect } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { fetchMock, makeRes } from './setup/helpers';
import './setup/setup';

describe('Error handling', () => {
  it('throws ApiError with message from JSON payload when "message" is present', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(400, { message: 'Bad stuff happened' }));

    let err: unknown;
    try {
      await api.get('/oops');
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      message: 'Bad stuff happened',
      status: 400,
    });
  });

  it('falls back to text body for non-JSON errors', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(500, 'Internal fail', 'text/plain'));

    await expect(api.get('/fail')).rejects.toMatchObject({
      message: 'Internal fail',
      status: 500,
    });
  });

  it('JSON error without "message" falls back to status text (empty in Node) and still has status', async () => {
    // Note: Node’s WHATWG Response typically has an empty statusText.
    // Our client falls back to `res.statusText` when JSON lacks "message".
    fetchMock.mockResolvedValueOnce(makeRes(422, { error: 'invalid' }));

    let err: unknown;
    try {
      await api.get('/no-message-field');
    } catch (e) {
      err = e;
    }

    // We assert only on type + status here; message may be empty ('') in Node.
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
  });
});
