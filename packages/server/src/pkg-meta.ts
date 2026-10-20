import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'metabot-core-server';

function releaseVersion(): string {
  const explicit = process.env.METABOT_RELEASE_VERSION?.trim();
  if (explicit) return explicit;

  // Personal Release bundles retain their root manifest after extraction.
  // Read it relative to both src/ (tsx) and dist/ (compiled runtime).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.resolve(here, '../../../.metabot-package/manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version?: unknown };
    if (typeof manifest.version === 'string' && manifest.version.trim()) {
      return manifest.version.trim();
    }
  } catch {
    // Source checkouts and standalone server installs have no bundle manifest.
  }

  return '0.1.0';
}

export const version = releaseVersion();
