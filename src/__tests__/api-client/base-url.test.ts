/**
 * Tests related to how the API client determines the base URL.
 */
import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchMock, makeRes } from './setup/helpers';
import './setup/setup';

describe('Base URL', () => {
  it('falls back to same-origin in the browser when public base is unset', async () => {
    // Simulate running in the browser with a specific origin
    const fakeWindow: Pick<Window, 'location'> = {
      location: { origin: 'https://app.example.com' } as Location,
    };
    globalThis.window = fakeWindow as Window & typeof globalThis;

    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.get('/health');

    const [urlArg] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toBe('https://app.example.com/health');
  });
});
