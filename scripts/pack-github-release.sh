#!/usr/bin/env bash
# Build the public GitHub Release assets. This intentionally wraps the shared
# runtime packer while keeping its internal/static output path untouched.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${METABOT_GITHUB_RELEASE_OUTPUT_DIR:-$REPO_ROOT/dist/github-release}"
PACK_SCRIPT="$REPO_ROOT/packages/server/scripts/pack-metabot.sh"
TMP_DIR="$(mktemp -d -t metabot-github-release.XXXXXX)"
GITHUB_TARBALL_URL="https://github.com/xvirobotics/metabot/releases/latest/download/metabot-runtime.tgz"
GITHUB_CHECKSUMS_URL="https://github.com/xvirobotics/metabot/releases/latest/download/SHA256SUMS"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR/metabot-runtime.tgz.new" "$OUTPUT_DIR/install.sh.new" "$OUTPUT_DIR/SHA256SUMS.new"

# Public releases are the complete self-hosted personal edition. Fail closed
# if an internal default-env injection leaks into the caller environment.
if [[ -n "${METABOT_PACKAGE_DEFAULT_ENV_FILE:-}" || -n "${METABOT_INTERNAL_DEFAULT_ENV_FILE:-}" ]]; then
  echo "error: public GitHub packages may not embed default env files" >&2
  exit 1
fi
METABOT_PACKAGE_FLAVOR=personal METABOT_PACK_OUTPUT_DIR="$TMP_DIR" bash "$PACK_SCRIPT"

cp "$TMP_DIR/latest.tgz" "$OUTPUT_DIR/metabot-runtime.tgz.new"

# The shared bootstrap retains the legacy core URL for private mirrors. The
# GitHub asset injects a public default while preserving an explicit caller
# override via METABOT_PACKAGE_TARBALL_URL.
awk -v url="$GITHUB_TARBALL_URL" -v checksums="$GITHUB_CHECKSUMS_URL" '
  NR == 1 {
    print
    print "export METABOT_PACKAGE_TARBALL_URL=\"${METABOT_PACKAGE_TARBALL_URL:-" url "}\""
    print "export METABOT_PACKAGE_CHECKSUMS_URL=\"${METABOT_PACKAGE_CHECKSUMS_URL:-" checksums "}\""
    next
  }
  { print }
' "$TMP_DIR/install.sh" > "$OUTPUT_DIR/install.sh.new"
chmod +x "$OUTPUT_DIR/install.sh.new"

(
  cd "$OUTPUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum metabot-runtime.tgz.new | sed 's/metabot-runtime\.tgz\.new/metabot-runtime.tgz/'
  else
    shasum -a 256 metabot-runtime.tgz.new | sed 's/metabot-runtime\.tgz\.new/metabot-runtime.tgz/'
  fi
) > "$OUTPUT_DIR/SHA256SUMS.new"

mv "$OUTPUT_DIR/metabot-runtime.tgz.new" "$OUTPUT_DIR/metabot-runtime.tgz"
mv "$OUTPUT_DIR/install.sh.new" "$OUTPUT_DIR/install.sh"
mv "$OUTPUT_DIR/SHA256SUMS.new" "$OUTPUT_DIR/SHA256SUMS"

echo "==> GitHub Release assets written to $OUTPUT_DIR"
