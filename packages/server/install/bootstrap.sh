#!/usr/bin/env bash
#
# metabot bootstrap — package one-line installer.
#
# Usage:
#   curl -fsSL https://github.com/xvirobotics/metabot/releases/latest/download/install.sh | bash
#   curl -fsSL ... | METABOT_HOME=/opt/metabot bash
#   curl -fsSL ... | bash -s -- --dir /opt/metabot
#
# What this does:
#   1. Resolve METABOT_HOME (--dir > env > $HOME/metabot).
#   2. Download the runtime tarball from METABOT_PACKAGE_TARBALL_URL, falling
#      back to the legacy metabot-core install endpoint.
#   3. Extract into $METABOT_HOME, overwriting code files (`bin/`, `src/`,
#      `packages/`, `install.sh`, etc.). User state — `.env`, `bots.json`,
#      `logs/`, `data/` — is NOT in the tarball and survives trivially.
#      Any pre-existing `.git/` is also preserved (tarball excludes it), so
#      developers who hand-clone can still `git pull` later if they want,
#      but the bootstrap itself never touches a remote.
#   4. If the package includes `.metabot-package/default.env`, copy it
#      to `~/.metabot/default.env` with chmod 600 and remove the extracted copy.
#   5. exec install.sh with METABOT_SKIP_GIT=1 so its Phase 2 skips the
#      clone/pull branch entirely and proceeds straight to npm install +
#      configuration prompts + PM2 start.
#
# Why no .git delegation: package installs are immutable release artifacts.
# Always pulling the tarball keeps package refresh independent from source
# checkout credentials and branch state.
#
# Refresh model: stable latest-release asset names, pinned by atomic publish.
# Re-run the one-liner or use `metabot update --package` to refresh.
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[bootstrap]${NC} $*"; }
warn()    { echo -e "${YELLOW}[bootstrap]${NC} $*"; }
error()   { echo -e "${RED}[bootstrap]${NC} $*" >&2; }
success() { echo -e "${GREEN}[bootstrap]${NC} $*"; }

echo ""
echo -e "${CYAN}  MetaBot bootstrap (release package install)${NC}"
echo ""

# ----- 1. parse flags (only --dir / -d; everything else is forwarded) -----
INSTALL_DIR_ARG=""
PASSTHRU_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir)
      [[ $# -ge 2 ]] || { error "$1 requires a path argument"; exit 1; }
      INSTALL_DIR_ARG="$2"
      PASSTHRU_ARGS+=("$1" "$2")
      shift 2
      ;;
    --dir=*)
      INSTALL_DIR_ARG="${1#--dir=}"
      PASSTHRU_ARGS+=("$1")
      shift
      ;;
    *)
      PASSTHRU_ARGS+=("$1")
      shift
      ;;
  esac
done

# ----- 2. resolve METABOT_HOME -----
if [[ -n "$INSTALL_DIR_ARG" ]]; then
  METABOT_HOME="$INSTALL_DIR_ARG"
elif [[ -n "${METABOT_HOME:-}" ]]; then
  : # already set
else
  METABOT_HOME="$HOME/metabot"
fi
METABOT_HOME="${METABOT_HOME/#\~/$HOME}"
if [[ "$METABOT_HOME" != /* ]]; then
  error "METABOT_HOME must be an absolute path, got: $METABOT_HOME"
  exit 1
fi
export METABOT_HOME

CURRENT_PACKAGE_VERSION=""
if [[ -f "$METABOT_HOME/.metabot-package/manifest.json" ]]; then
  CURRENT_PACKAGE_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' \
    "$METABOT_HOME/.metabot-package/manifest.json" | head -n 1)"
fi

# ----- 3. preflight: curl + tar are mandatory; node check is install.sh's job -----
for cmd in curl tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "$cmd is required but not on PATH."
    exit 1
  fi
done

# ----- 4. heads-up if we're overlaying onto an existing git checkout -----
# We do NOT delegate to its install.sh because package refresh is independent
# from the checkout's remote and branch state. `.git/` is excluded from the
# tarball, so it remains available for an explicit `metabot update --git`.
if [[ -d "$METABOT_HOME/.git" ]]; then
  info "Existing .git/ at $METABOT_HOME left intact — tarball will overlay code only."
fi

# ----- 5. download + extract tarball (always) -----
CORE_URL="${METABOT_CORE_URL:-http://localhost:9200}"
TARBALL_URL="${METABOT_PACKAGE_TARBALL_URL:-$CORE_URL/install/latest.tgz}"
CHECKSUMS_URL="${METABOT_PACKAGE_CHECKSUMS_URL:-}"
TMPDIR_BOOT="$(mktemp -d -t metabot-install.XXXXXX)"
trap 'rm -rf "$TMPDIR_BOOT"' EXIT
TARBALL_PATH="$TMPDIR_BOOT/metabot.tgz"

info "Downloading $TARBALL_URL"
if ! curl -fsSL "$TARBALL_URL" -o "$TARBALL_PATH"; then
  error "Download failed. Is the release package reachable at this URL?"
  error "  URL: $TARBALL_URL"
  error "  Override with: METABOT_PACKAGE_TARBALL_URL=https://… curl … | bash"
  exit 1
fi

if [[ ! -s "$TARBALL_PATH" ]]; then
  error "Downloaded tarball is empty."
  exit 1
fi
if ! tar -tzf "$TARBALL_PATH" >/dev/null 2>&1; then
  error "Downloaded file is not a valid tarball:"
  head -c 200 "$TARBALL_PATH" >&2
  echo "" >&2
  exit 1
fi

if [[ -n "$CHECKSUMS_URL" ]]; then
  CHECKSUMS_PATH="$TMPDIR_BOOT/SHA256SUMS"
  info "Verifying release checksum"
  if ! curl -fsSL "$CHECKSUMS_URL" -o "$CHECKSUMS_PATH"; then
    error "Checksum download failed: $CHECKSUMS_URL"
    exit 1
  fi
  EXPECTED_SHA256="$(awk '$2 == "metabot-runtime.tgz" { print $1; exit }' "$CHECKSUMS_PATH")"
  if [[ ! "$EXPECTED_SHA256" =~ ^[a-fA-F0-9]{64}$ ]]; then
    error "SHA256SUMS does not contain a valid metabot-runtime.tgz entry"
    exit 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(sha256sum "$TARBALL_PATH" | awk '{print $1}')"
  else
    ACTUAL_SHA256="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"
  fi
  if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
    error "Release checksum mismatch; refusing to extract"
    exit 1
  fi
  success "Release checksum verified"
fi

PACKAGE_MANIFEST_STAGED="$TMPDIR_BOOT/manifest.json"
if ! tar -xOf "$TARBALL_PATH" .metabot-package/manifest.json > "$PACKAGE_MANIFEST_STAGED" 2>/dev/null \
  && ! tar -xOf "$TARBALL_PATH" ./.metabot-package/manifest.json > "$PACKAGE_MANIFEST_STAGED" 2>/dev/null; then
  error "Release package manifest is missing or is not a complete MetaBot Personal Edition."
  exit 1
fi
NEW_PACKAGE_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' \
  "$PACKAGE_MANIFEST_STAGED" | head -n 1)"
if [[ -z "$NEW_PACKAGE_VERSION" ]] \
  || [[ ! "$NEW_PACKAGE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || ! grep -Eq '"package"[[:space:]]*:[[:space:]]*"metabot-personal-edition"' "$PACKAGE_MANIFEST_STAGED" \
  || ! grep -Eq '"includesCore"[[:space:]]*:[[:space:]]*true' "$PACKAGE_MANIFEST_STAGED" \
  || ! grep -Eq '"includesWebUi"[[:space:]]*:[[:space:]]*true' "$PACKAGE_MANIFEST_STAGED"; then
  error "Release package manifest is missing or is not a complete MetaBot Personal Edition."
  exit 1
fi
if [[ -n "${METABOT_EXPECTED_PACKAGE_VERSION:-}" ]] \
  && [[ "$NEW_PACKAGE_VERSION" != "${METABOT_EXPECTED_PACKAGE_VERSION#v}" ]]; then
  error "Release version mismatch: expected ${METABOT_EXPECTED_PACKAGE_VERSION#v}, got $NEW_PACKAGE_VERSION"
  exit 1
fi

mkdir -p "$METABOT_HOME"
info "Extracting Personal Edition v${NEW_PACKAGE_VERSION} into $METABOT_HOME"
# Plain `tar xzf` overwrites tarball-tracked files in-place. We don't use
# --keep-newer-files because the pack script stamps every entry with a fixed
# `--mtime='UTC 2026-01-01'` for deterministic output — local files modified
# any time after that (i.e. essentially all of them on a real machine) would
# be silently kept, defeating the purpose of an overlay refresh.
#
# Files NOT in the tarball survive trivially because tar never deletes:
#   - .env / bots.json / logs/ / data/  (user state, never packed)
#   - .git/  (excluded so manual `git pull` still possible if desired)
#   - node_modules/  (excluded; Phase 3 npm install reconciles)
tar xzf "$TARBALL_PATH" -C "$METABOT_HOME"

if [[ -n "$CURRENT_PACKAGE_VERSION" ]]; then
  success "Personal Edition staged: v${CURRENT_PACKAGE_VERSION} → v${NEW_PACKAGE_VERSION}"
else
  success "Personal Edition v${NEW_PACKAGE_VERSION} staged"
fi

# v1.2.0 consolidated the historical Bridge Live UI into packages/web-ui.
# Package overlays intentionally do not delete arbitrary files, so remove only
# the known legacy application when its package identity proves ownership.
if [[ -f "$METABOT_HOME/web/package.json" ]] \
  && grep -Eq '"name"[[:space:]]*:[[:space:]]*"metabot-web"' "$METABOT_HOME/web/package.json"; then
  rm -rf "$METABOT_HOME/web" "$METABOT_HOME/dist/web"
  success "Removed the retired Bridge Web UI; Core Console is now the only browser frontend"
fi

PACKAGE_DEFAULT_ENV="$METABOT_HOME/.metabot-package/default.env"
if [[ -f "$PACKAGE_DEFAULT_ENV" ]]; then
  mkdir -p "$HOME/.metabot"
  cp "$PACKAGE_DEFAULT_ENV" "$HOME/.metabot/default.env"
  chmod 600 "$HOME/.metabot/default.env"
  rm -f "$PACKAGE_DEFAULT_ENV"
  success "Installed packaged default env at $HOME/.metabot/default.env"
fi

if [[ ! -f "$METABOT_HOME/install.sh" ]]; then
  error "Extraction completed but install.sh is missing at $METABOT_HOME/install.sh"
  error "Tarball may be corrupt. Re-run the bootstrap; if it fails again, ping infra."
  exit 1
fi

# ----- 6. delegate to install.sh (Phase 2 sees METABOT_SKIP_GIT=1) -----
cd "$METABOT_HOME"
export METABOT_SKIP_GIT=1
success "Tarball staged at $METABOT_HOME — handing off to install.sh."
echo ""
if [[ ${#PASSTHRU_ARGS[@]} -gt 0 ]]; then
  exec bash "$METABOT_HOME/install.sh" "${PASSTHRU_ARGS[@]}"
else
  exec bash "$METABOT_HOME/install.sh"
fi
