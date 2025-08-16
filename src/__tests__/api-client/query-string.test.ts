/**
 * Tests for query-string handling (skips null/undefined and encodes values).
 */
import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchMock, makeRes } from './setup/helpers';
import './setup/setup';

describe('Query string handling', () => {
  it('encodes values and skips null/undefined', async () => {
    // Simulate a browser origin so same-origin fallback is deterministic
    const fakeWindow: Pick<Window, 'location'> = {
      location: { origin: 'https://app.example.com' } as Location,
    };
    globalThis.window = fakeWindow as Window & typeof globalThis;

    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.get('/search', {
      q: 'hello world', // should be encoded
      page: 2, // should be included
      skipNull: null, // should be omitted
      skipUndef: undefined, // should be omitted
    });

    const [urlArg] = fetchMock.mock.calls[0];
    const url = String(urlArg);

    // URLSearchParams may encode spaces as `%20` or `+` depending on env
    const encodesSpace = /q=hello(%20|\+)world/.test(url);
    expect(encodesSpace).toBe(true);

    expect(url).toContain('page=2');
    expect(url).not.toContain('skipNull');
    expect(url).not.toContain('skipUndef');
  });
});
