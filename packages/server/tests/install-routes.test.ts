import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

// Sibling-of-cli-distribution test: same static layout, but the /install/*
// path family (bot-host tarball + bootstrap) instead of /cli/*.
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = path.join(PKG_DIR, 'static');
const INSTALL_DIR = path.join(STATIC_DIR, 'install');
const BOOTSTRAP_SH = '#!/usr/bin/env bash\necho metabot-bootstrap-fixture\n';
// gzip-magic-prefixed bytes — only the Content-Type assertion depends on it.
const TARBALL_BYTES = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x12, 0x34, 0x56, 0x78]);

let kit: ServerKit | undefined;
let createdStatic = false;
let createdInstallDir = false;
let preExistingInstallSh: Buffer | undefined;
let preExistingTarball: Buffer | undefined;

beforeEach(() => {
  if (!fs.existsSync(STATIC_DIR)) {
    fs.mkdirSync(STATIC_DIR, { recursive: true });
    createdStatic = true;
  }
  if (!fs.existsSync(INSTALL_DIR)) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    createdInstallDir = true;
  }
  const installPath = path.join(INSTALL_DIR, 'install.sh');
  const tarballPath = path.join(INSTALL_DIR, 'latest.tgz');
  if (fs.existsSync(installPath)) preExistingInstallSh = fs.readFileSync(installPath);
  if (fs.existsSync(tarballPath)) preExistingTarball = fs.readFileSync(tarballPath);
  fs.writeFileSync(installPath, BOOTSTRAP_SH);
  fs.writeFileSync(tarballPath, TARBALL_BYTES);
});

afterEach(async () => {
  delete process.env.METABOT_PUBLIC_DISTRIBUTION;
  await kit?.cleanup();
  kit = undefined;
  const installPath = path.join(INSTALL_DIR, 'install.sh');
  const tarballPath = path.join(INSTALL_DIR, 'latest.tgz');
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
  if (createdInstallDir) {
    try { fs.rmdirSync(INSTALL_DIR); } catch { /* ignore */ }
    createdInstallDir = false;
  }
  if (createdStatic) {
    try { fs.rmdirSync(STATIC_DIR); } catch { /* ignore */ }
    createdStatic = false;
  }
  preExistingInstallSh = undefined;
  preExistingTarball = undefined;
});

describe('Install distribution endpoints (anonymous when METABOT_PUBLIC_DISTRIBUTION=1)', () => {
  beforeEach(async () => {
    process.env.METABOT_PUBLIC_DISTRIBUTION = '1';
    kit = await startTestServer('install-dist');
  });

  it('GET /install/install.sh serves the bootstrap with shellscript Content-Type, no auth', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/install/install.sh');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/x-shellscript');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(BOOTSTRAP_SH);
  });

  it('GET /install/latest.tgz serves the tarball with gzip Content-Type, no auth', async () => {
    const res = await fetch(`${kit!.baseUrl}/install/latest.tgz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/gzip');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(TARBALL_BYTES.length);
    expect(buf.equals(TARBALL_BYTES)).toBe(true);
  });

  it('HEAD /install/latest.tgz serves headers with no auth', async () => {
    const res = await rawRequest(kit!.port, 'HEAD', '/install/latest.tgz');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('application/gzip');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('');
  });

  it('GET /install/install.sh works on the UI host (no auth, same handler)', async () => {
    await kit!.cleanup();
    kit = await startTestServer('install-dist-ui', { uiHost: 'test-ui.local' });
    const res = await rawRequest(kit!.port, 'GET', '/install/install.sh', { Host: 'test-ui.local' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/x-shellscript');
  });

  it('POST /install/install.sh falls through to 404 (GET-only handler)', async () => {
    const res = await rawRequest(
      kit!.port,
      'POST',
      '/install/install.sh',
      { 'Content-Type': 'application/json' },
      '{}',
    );
    expect(res.status).toBe(404);
  });

  it('GET /install/other-file returns 404 (only install.sh and latest.tgz match)', async () => {
    fs.writeFileSync(path.join(INSTALL_DIR, 'sneaky.sh'), 'whatever');
    try {
      const res = await rawRequest(kit!.port, 'GET', '/install/sneaky.sh');
      expect(res.status).toBe(404);
    } finally {
      fs.unlinkSync(path.join(INSTALL_DIR, 'sneaky.sh'));
    }
  });

  it('GET /install/install.sh returns 404 install_not_built when file missing', async () => {
    fs.unlinkSync(path.join(INSTALL_DIR, 'install.sh'));
    const res = await rawRequest(kit!.port, 'GET', '/install/install.sh');
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('install_not_built');
    fs.writeFileSync(path.join(INSTALL_DIR, 'install.sh'), BOOTSTRAP_SH);
  });

  it('does not affect Bearer-auth routes (regression: /api/agents still 401 anonymous)', async () => {
    const res = await call(kit!.baseUrl, 'GET', '/api/agents', null);
    expect(res.status).toBe(401);
  });
});

describe('Install distribution endpoints (default: token-gated)', () => {
  beforeEach(async () => {
    delete process.env.METABOT_PUBLIC_DISTRIBUTION;
    kit = await startTestServer('install-dist-gated');
  });

  it('GET /install/install.sh without a token returns 401', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/install/install.sh');
    expect(res.status).toBe(401);
  });

  it('GET /install/latest.tgz without a token returns 401', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/install/latest.tgz');
    expect(res.status).toBe(401);
  });

  it('GET /install/install.sh with a valid Bearer token serves the bootstrap', async () => {
    const res = await rawRequest(kit!.port, 'GET', '/install/install.sh', {
      Authorization: `Bearer ${kit!.adminToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe(BOOTSTRAP_SH);
  });

  it('slash-variant paths cannot bypass the gate (regression: //, trailing /)', async () => {
    for (const p of ['/install//install.sh', '/install/install.sh/', '/install//latest.tgz']) {
      const res = await rawRequest(kit!.port, 'GET', p);
      expect(res.status).not.toBe(200);
      expect(res.body).not.toBe(BOOTSTRAP_SH);
    }
  });

  it('on the UI host, slash-variant distribution paths are not served anonymously (regression)', async () => {
    await kit!.cleanup();
    kit = await startTestServer('install-dist-gated-ui', { uiHost: 'test-ui.local' });
    for (const p of ['/install/install.sh', '/install//install.sh', '/install/install.sh/']) {
      const res = await rawRequest(kit!.port, 'GET', p, { Host: 'test-ui.local' });
      expect(res.status).not.toBe(200);
      expect(res.body).not.toBe(BOOTSTRAP_SH);
    }
  });
});
