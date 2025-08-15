/**
 * Tests related to authentication headers and Content-Type behavior.
 */
import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchMock, makeRes } from './setup/helpers';
import './setup/setup';

describe('Auth & headers', () => {
  it('adds Authorization header after setAuth()', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    api.setAuth('shhh-token');
    await api.get('/me');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init!.headers);
    expect(headers.get('Authorization')).toBe('Bearer shhh-token');
  });

  it('does NOT set Content-Type when sending FormData (multipart)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    const fd = new FormData();
    fd.set('file', new Blob(['hi'], { type: 'text/plain' }), 'hi.txt');

    // @ts-expect-error: post() options omit `body` by design; we pass it via `opts.body` for this test
    await api.post('/upload', undefined, { body: fd });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init!.headers);
    // Important: we let the browser set the multipart boundary automatically
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('removes a manually provided Content-Type when body is multipart', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    const fd = new FormData();
    fd.set('file', new Blob(['hi'], { type: 'text/plain' }), 'hi.txt');

    // Even if a caller tries to force a content-type, the client should drop it for multipart.
    await api.post('/upload', fd, { headers: { 'Content-Type': 'application/json' } });

    const [, init] = fetchMock.mock.calls[0];
    const h = new Headers(init!.headers);
    expect(h.has('Content-Type')).toBe(false);
  });

  it('merges custom headers with defaults', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.get('/custom', undefined, { headers: { 'X-Test': 'yes' } });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init!.headers);
    expect(headers.get('X-Test')).toBe('yes');
    // Default JSON header still present for non-multipart requests
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
