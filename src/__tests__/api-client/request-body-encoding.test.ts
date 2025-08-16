/**
 * Tests for how the client encodes request bodies based on headers/body type.
 */
import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchMock, makeRes } from './setup/helpers';
import './setup/setup';

describe('Request body encoding', () => {
  it('stringifies JSON bodies when Content-Type is application/json', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.post('/json', { foo: 'bar' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init!.body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('passes plain text bodies through unchanged when Content-Type is text/plain', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.post('/text', 'hello world', { headers: { 'Content-Type': 'text/plain' } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init!.body).toBe('hello world');
  });

  it('keeps body undefined (does NOT send "{}") when there is no body', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    // Default headers include application/json; we still should NOT send an empty object body
    await api.post('/no-body');

    const [, init] = fetchMock.mock.calls[0];
    expect(init!.body).toBeUndefined();
  });

  it('never sends a body for GET requests', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    await api.get('/never-has-body');

    const [, init] = fetchMock.mock.calls[0];
    // Our implementation never sets a body for GET
    expect(init!.body).toBeUndefined();
  });
});
