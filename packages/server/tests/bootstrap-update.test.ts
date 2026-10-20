import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BOOTSTRAP = path.join(REPO_ROOT, 'packages/server/install/bootstrap.sh');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createUpgradeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metabot-bootstrap-update-'));
  tempDirs.push(root);
  const home = path.join(root, 'home');
  const installDir = path.join(home, 'metabot');
  const payload = path.join(root, 'payload');
  const tarball = path.join(root, 'metabot-runtime.tgz');
  const checksums = path.join(root, 'SHA256SUMS');
  const marker = path.join(root, 'install-marker.txt');

  fs.mkdirSync(path.join(installDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(installDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(installDir, 'dist/web'), { recursive: true });
  fs.mkdirSync(path.join(home, '.metabot-core/data'), { recursive: true });
  fs.mkdirSync(path.join(home, '.metabot'), { recursive: true });
  fs.writeFileSync(path.join(installDir, '.env'), 'API_SECRET=preserve-me\n');
  fs.writeFileSync(path.join(installDir, 'bots.json'), '{"feishuBots":[]}\n');
  fs.writeFileSync(path.join(installDir, 'logs/keep.log'), 'log-state\n');
  fs.writeFileSync(path.join(installDir, 'data/keep.db'), 'bridge-state\n');
  fs.writeFileSync(path.join(installDir, 'dist/web/index.html'), 'retired-ui\n');
  writeJson(path.join(installDir, 'package.json'), { name: 'metabot', version: '1.1.0' });
  fs.writeFileSync(path.join(home, '.metabot-core/token'), 'core-token\n', { mode: 0o600 });
  fs.writeFileSync(path.join(home, '.metabot-core/data/central.db'), 'core-state\n');
  fs.writeFileSync(path.join(home, '.metabot/state.txt'), 'home-state\n');
  writeJson(path.join(installDir, '.metabot-package/manifest.json'), {
    schemaVersion: 1,
    package: 'metabot-personal-edition',
    version: '1.1.0',
    includesCore: true,
    includesWebUi: true,
  });
  writeJson(path.join(installDir, 'web/package.json'), { name: 'metabot-web' });

  writeJson(path.join(payload, '.metabot-package/manifest.json'), {
    schemaVersion: 1,
    package: 'metabot-personal-edition',
    version: '1.2.0',
    includesCore: true,
    includesWebUi: true,
  });
  writeJson(path.join(payload, 'package.json'), { name: 'metabot', version: '1.2.0' });
  fs.writeFileSync(
    path.join(payload, 'install.sh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'test -f "$METABOT_HOME/.env"',
      'test -f "$METABOT_HOME/bots.json"',
      'test -f "$METABOT_HOME/logs/keep.log"',
      'test -f "$METABOT_HOME/data/keep.db"',
      'test -f "$HOME/.metabot-core/token"',
      'test -f "$HOME/.metabot-core/data/central.db"',
      'test -f "$HOME/.metabot/state.txt"',
      'test ! -e "$METABOT_HOME/web"',
      'test ! -e "$METABOT_HOME/dist/web"',
      'printf "updated:%s\\n" "$(sed -n \'s/.*"version"[[:space:]]*:[[:space:]]*"\\([0-9][0-9.]*\\)".*/\\1/p\' "$METABOT_HOME/.metabot-package/manifest.json" | head -n 1)" > "$UPDATE_MARKER"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  execFileSync('tar', ['czf', tarball, '-C', payload, '.']);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
  fs.writeFileSync(checksums, `${sha}  metabot-runtime.tgz\n`);

  return { root, home, installDir, tarball, checksums, marker };
}

describe('package bootstrap upgrades', () => {
  it('upgrades 1.1.0 to 1.2.0 while preserving user and Core state', () => {
    const fixture = createUpgradeFixture();
    execFileSync('bash', [BOOTSTRAP], {
      env: {
        ...process.env,
        HOME: fixture.home,
        METABOT_HOME: fixture.installDir,
        METABOT_PACKAGE_TARBALL_URL: `file://${fixture.tarball}`,
        METABOT_PACKAGE_CHECKSUMS_URL: `file://${fixture.checksums}`,
        METABOT_EXPECTED_PACKAGE_VERSION: '1.2.0',
        UPDATE_MARKER: fixture.marker,
      },
      stdio: 'pipe',
    });

    expect(fs.readFileSync(fixture.marker, 'utf-8')).toBe('updated:1.2.0\n');
    expect(fs.readFileSync(path.join(fixture.installDir, '.env'), 'utf-8')).toBe('API_SECRET=preserve-me\n');
    expect(fs.readFileSync(path.join(fixture.installDir, 'bots.json'), 'utf-8')).toContain('feishuBots');
    expect(fs.readFileSync(path.join(fixture.home, '.metabot-core/token'), 'utf-8')).toBe('core-token\n');
    expect(fs.readFileSync(path.join(fixture.home, '.metabot-core/data/central.db'), 'utf-8')).toBe('core-state\n');
    expect(fs.existsSync(path.join(fixture.installDir, 'web'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.installDir, 'dist/web'))).toBe(false);
  });

  it('fails closed when a pinned release returns the wrong version', () => {
    const fixture = createUpgradeFixture();
    expect(() =>
      execFileSync('bash', [BOOTSTRAP], {
        env: {
          ...process.env,
          HOME: fixture.home,
          METABOT_HOME: fixture.installDir,
          METABOT_PACKAGE_TARBALL_URL: `file://${fixture.tarball}`,
          METABOT_PACKAGE_CHECKSUMS_URL: `file://${fixture.checksums}`,
          METABOT_EXPECTED_PACKAGE_VERSION: '9.9.9',
          UPDATE_MARKER: fixture.marker,
        },
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(fs.existsSync(fixture.marker)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(fixture.installDir, 'package.json'), 'utf-8')).version).toBe('1.1.0');
    expect(
      JSON.parse(fs.readFileSync(path.join(fixture.installDir, '.metabot-package/manifest.json'), 'utf-8')).version,
    ).toBe('1.1.0');
    expect(fs.existsSync(path.join(fixture.installDir, 'web'))).toBe(true);
  });
});
