import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = path.join(PKG_DIR, 'static');
const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const ASSET_JS = "console.log('hello');\n";

let kit: ServerKit | undefined;
let createdStatic = false;
let createdAssetsDir = false;
let preExistingIndex: Buffer | undefined;
let preExistingAssetJs: Buffer | undefined;

beforeEach(() => {
  if (!fs.existsSync(STATIC_DIR)) {
    fs.mkdirSync(STATIC_DIR, { recursive: true });
    createdStatic = true;
  }
  const assetsDir = path.join(STATIC_DIR, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    createdAssetsDir = true;
  }
  const indexPath = path.join(STATIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) preExistingIndex = fs.readFileSync(indexPath);
  fs.writeFileSync(indexPath, INDEX_HTML);
  const assetPath = path.join(assetsDir, 'app.js');
  if (fs.existsSync(assetPath)) preExistingAssetJs = fs.readFileSync(assetPath);
  fs.writeFileSync(assetPath, ASSET_JS);
});

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
  // Restore / clean up the static files we wrote.
  const indexPath = path.join(STATIC_DIR, 'index.html');
  const assetPath = path.join(STATIC_DIR, 'assets', 'app.js');
  if (preExistingIndex !== undefined) {
    fs.writeFileSync(indexPath, preExistingIndex);
  } else if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
  }
  if (preExistingAssetJs !== undefined) {
    fs.writeFileSync(assetPath, preExistingAssetJs);
  } else if (fs.existsSync(assetPath)) {
    fs.unlinkSync(assetPath);
  }
  if (createdAssetsDir) {
    try { fs.rmdirSync(path.join(STATIC_DIR, 'assets')); } catch { /* ignore */ }
    createdAssetsDir = false;
  }
  if (createdStatic) {
    try { fs.rmdirSync(STATIC_DIR); } catch { /* ignore */ }
    createdStatic = false;
  }
  preExistingIndex = undefined;
  preExistingAssetJs = undefined;
});

describe('UI host dispatch — uiHost set', () => {
  beforeEach(async () => {
    kit = await startTestServer('ui-host', { uiHost: 'test-ui.local' });
  });

  it('GET / on UI host serves index.html with no-cache', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('GET /assets/app.js on UI host serves with immutable cache', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/assets/app.js', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('application/javascript');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body).toBe(ASSET_JS);
  });

  it('SPA fallback: unknown GET path serves index.html', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/some/unknown/route', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('Host header is case-insensitive', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/', { Host: 'TEST-UI.LOCAL' });
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('Host header with port still matches', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/', { Host: `test-ui.local:${kit!.port}` });
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('traversal attempts cannot escape STATIC_DIR (URL normalization + resolve guard)', async () => {
    // node:URL parser normalizes /../ and percent-encoded variants away before
    // they reach the static-serve handler. End result: the request resolves
    // inside STATIC_DIR (file-not-found → SPA fallback to index.html), never
    // serving anything from the parent directory.
    for (const evilPath of [
      '/../package.json',
      '/%2e%2e/package.json',
      '/foo/../../package.json',
      '/assets/../../package.json',
    ]) {
      const res = await rawRequest(kit!.port, 'GET', evilPath, { Host: 'test-ui.local' });
      expect(res.status).toBe(200);
      // Must be the SPA fallback, NOT the real package.json from the parent dir.
      expect(String(res.headers['content-type'])).toContain('text/html');
      expect(res.body).toBe(INDEX_HTML);
    }
  });

  it('POST to non-API path on UI host returns 404 (no upload via static-serve)', async () => {
    const res = await rawRequest(
      kit!.port,
      'POST',
      '/upload.html',
      { Host: 'test-ui.local', 'Content-Type': 'application/json' },
      '{}',
    );
    expect(res.status).toBe(404);
  });

  it('/api/manifest still works on UI host (no static-serve interception)', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/api/manifest', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.schemaVersion).toBe(1);
    expect(body.capabilities.memory).toBe(true);
  });

  it('/health still works on UI host', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/health', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
  });

  it('non-UI host falls through to 404 (no static-serve)', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/', { Host: 'other.example.com' });
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('not_found');
  });

  it('non-UI host /api/manifest still works (preserves existing behavior)', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/api/manifest', { Host: 'other.example.com' });
    expect(res.status).toBe(200);
  });
});

describe('UI host dispatch — uiHost unset (personal edition default)', () => {
  beforeEach(async () => {
    kit = await startTestServer('ui-host-off');
  });

  it('GET / serves the local personal Web UI for any Host header', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('GET /api/manifest still works (default-off does not break API)', async () => {
    const res = await call(kit!.baseUrl, 'GET', '/api/manifest', null);
    expect(res.status).toBe(200);
  });
});
