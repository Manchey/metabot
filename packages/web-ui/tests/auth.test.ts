import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, ApiError } from '../src/lib/api';
import { API_TOKEN_STORAGE_KEY, clearApiToken, getApiToken, setApiToken } from '../src/lib/auth';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

describe('personal edition token auth', () => {
  const storage = new MemoryStorage();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores a normalized local API token and clears it on sign-out', () => {
    setApiToken('  personal-token  ');
    expect(getApiToken()).toBe('personal-token');
    expect(storage.getItem(API_TOKEN_STORAGE_KEY)).toBe('personal-token');
    clearApiToken();
    expect(getApiToken()).toBe('');
  });

  it('sends the browser token as a Bearer credential', async () => {
    setApiToken('personal-token');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ botName: 'local' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.whoami();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/whoami',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer personal-token' }),
        credentials: 'same-origin',
      }),
    );
  });

  it('forgets a rejected token instead of redirecting to an SSO endpoint', async () => {
    setApiToken('expired-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'invalid_token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    );

    await expect(api.whoami()).rejects.toBeInstanceOf(ApiError);
    expect(getApiToken()).toBe('');
  });

  it('does not ship oauth2-proxy sign-in or sign-out routes in the SPA', () => {
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const source = [
      fs.readFileSync(path.join(srcDir, 'App.tsx'), 'utf8'),
      fs.readFileSync(path.join(srcDir, 'lib/api.ts'), 'utf8'),
    ].join('\n');
    expect(source).not.toContain('/oauth2/sign_in');
    expect(source).not.toContain('/oauth2/sign_out');
    expect(source).not.toContain('X-Forwarded-Email');
  });
});
