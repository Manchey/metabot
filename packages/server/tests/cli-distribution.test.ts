import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

// Mirror the layout server.ts assumes: STATIC_DIR is resolved relative to
// dist/, but the test imports the source directly so it points at
// `packages/server/static/cli/`. We write fixtures there and clean up.
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = path.join(PKG_DIR, 'static');
const CLI_DIR = path.join(STATIC_DIR, 'cli');
const INSTALL_SH = '#!/usr/bin/env bash\necho hello-from-fixture\n';
// gzip-magic-prefixed bytes so the Content-Type assertion is meaningful;
// not a real tarball — server only ever streams the file as-is.
const TARBALL_BYTES = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);

let kit: ServerKit | undefined;
let createdStatic = false;
let createdCliDir = false;
let preExistingInstallSh: Buffer | undefined;
let preExistingTarball: Buffer | undefined;

beforeEach(() => {
  if (!fs.existsSync(STATIC_DIR)) {
    fs.mkdirSync(STATIC_DIR, { recursive: true });
    createdStatic = true;
  }
  if (!fs.existsSync(CLI_DIR)) {
    fs.mkdirSync(CLI_DIR, { recursive: true });
    createdCliDir = true;
  }
  const installPath = path.join(CLI_DIR, 'install.sh');
  const tarballPath = path.join(CLI_DIR, 'latest.tgz');
  if (fs.existsSync(installPath)) preExistingInstallSh = fs.readFileSync(installPath);
  if (fs.existsSync(tarballPath)) preExistingTarball = fs.readFileSync(tarballPath);
  fs.writeFileSync(installPath, INSTALL_SH);
  fs.writeFileSync(tarballPath, TARBALL_BYTES);
});

afterEach(async () => {
  // Never let the opt-in flag leak into other test files (singleFork shares process.env).
  delete process.env.METABOT_PUBLIC_DISTRIBUTION;
  await kit?.cleanup();
  kit = undefined;
  const installPath = path.join(CLI_DIR, 'install.sh');
  const tarballPath = path.join(CLI_DIR, 'latest.tgz');
  if (preExistingInstallSh !== undefined) {
    fs.writeFileSync(installPath, preExistingInstallSh);
  } else if (fs.existsSync(installPath)) {
    fs.unlinkSync(installPath);
  }
  if (preExistingTarball !== undefined) {
    fs.writeFileSync(tarballPath, preExistingTarball);
  } else if (fs.existsSync(tarballPath)) {
    fs.unlinkSync(tarballPath);
  }
  if (createdCliDir) {
    try { fs.rmdirSync(CLI_DIR); } catch { /* ignore */ }
    createdCliDir = false;
  }
  if (createdStatic) {
    try { fs.rmdirSync(STATIC_DIR); } catch { /* ignore */ }
    createdStatic = false;
  }
  preExistingInstallSh = undefined;
  preExistingTarball = undefined;
});

describe('CLI distribution endpoints (anonymous when METABOT_PUBLIC_DISTRIBUTION=1)', () => {
  beforeEach(async () => {
    // Personal edition gates distribution behind auth by default; opt back in
    // to anonymous serving for this suite.
    process.env.METABOT_PUBLIC_DISTRIBUTION = '1';
    kit = await startTestServer('cli-dist');
  });

  it('GET /cli/install.sh serves the script with shellscript Content-Type, no auth', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/cli/install.sh');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/x-shellscript');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INSTALL_SH);
  });

  it('GET /cli/latest.tgz serves the tarball with gzip Content-Type, no auth', async () => {
    // Use fetch + arrayBuffer so the binary body survives intact (rawRequest's
    // utf-8 decode mangles the gzip magic prefix).
    const res = await fetch(`${kit!.baseUrl}/cli/latest.tgz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/gzip');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(TARBALL_BYTES.length);
    expect(buf.equals(TARBALL_BYTES)).toBe(true);
  });

  it('HEAD /cli/latest.tgz serves headers with no auth', async () => {
    const res = await rawRequest(kit!.port, 'HEAD', '/cli/latest.tgz');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('application/gzip');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('');
  });

  it('GET /cli/install.sh works on the UI host (no auth, same handler)', async () => {
    await kit!.cleanup();
    kit = await startTestServer('cli-dist-ui', { uiHost: 'test-ui.local' });
    const res = await rawRequest(kit!.port, 'GET', '/cli/install.sh', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/x-shellscript');
  });

  it('POST /cli/install.sh is not allowed — falls through to 404', async () => {
    const res = await rawRequest(
      kit!.port,
      'POST',
      '/cli/install.sh',
      { 'Content-Type': 'application/json' },
      '{}',
    );
    expect(res.status).toBe(404);
  });

  it('GET /cli/other-file returns 404 (only install.sh and latest.tgz)', async () => {
    fs.writeFileSync(path.join(CLI_DIR, 'sneaky.sh'), 'whatever');
    try {
      const res = await rawRequest(kit!.port, 'GET', '/cli/sneaky.sh');
      // Falls through to the generic non-/api/ 404 (no Bearer, no UI host).
      expect(res.status).toBe(404);
    } finally {
      fs.unlinkSync(path.join(CLI_DIR, 'sneaky.sh'));
    }
  });

  it('GET /cli/install.sh returns 404 cli_not_installed if file missing', async () => {
    fs.unlinkSync(path.join(CLI_DIR, 'install.sh'));
    const res = await rawRequest(kit!.port, 'GET', '/cli/install.sh');
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('cli_not_installed');
    // Re-write so the afterEach cleanup logic doesn't trip.
    fs.writeFileSync(path.join(CLI_DIR, 'install.sh'), INSTALL_SH);
  });

  it('does not affect Bearer-auth routes (regression: /api/agents still 401 anonymous)', async () => {
    const res = await call(kit!.baseUrl, 'GET', '/api/agents', null);
    expect(res.status).toBe(401);
  });
});

describe('CLI distribution endpoints (default: token-gated)', () => {
  beforeEach(async () => {
    // Default personal-edition behavior: no METABOT_PUBLIC_DISTRIBUTION set.
    delete process.env.METABOT_PUBLIC_DISTRIBUTION;
    kit = await startTestServer('cli-dist-gated');
  });

  it('GET /cli/install.sh without a token returns 401 (no anonymous serving)', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/cli/install.sh');
    expect(res.status).toBe(401);
  });

  it('GET /cli/latest.tgz without a token returns 401', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/cli/latest.tgz');
    expect(res.status).toBe(401);
  });

  it('GET /cli/install.sh with a valid Bearer token serves the script', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/cli/install.sh', {
      Authorization: `Bearer ${kit!.adminToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe(INSTALL_SH);
  });

  it('slash-variant paths cannot bypass the gate (regression: //, trailing /)', async () => {
    for (const p of ['/cli//install.sh', '/cli/install.sh/', '/cli//latest.tgz']) {
      const res = await rawRequest(kit!.port, 'GET', p);
      expect(res.status).not.toBe(200);
      expect(res.body).not.toBe(INSTALL_SH);
    }
  });

  it('on the UI host, slash-variant distribution paths are not served anonymously (regression)', async () => {
    await kit!.cleanup();
    kit = await startTestServer('cli-dist-gated-ui', { uiHost: 'test-ui.local' });
    for (const p of ['/cli/install.sh', '/cli//install.sh', '/cli/install.sh/']) {
      const res = await rawRequest(kit!.port, 'GET', p, { Host: 'test-ui.local' });
      expect(res.status).not.toBe(200);
      expect(res.body).not.toBe(INSTALL_SH);
    }
  });
});
