#!/usr/bin/env bash
#
# metabot-core — generic self-host systemd installer.
#
# Idempotent: safe to re-run. Steps:
#   - mkdir -p the data root (default: $HOME/.metabot-core/data)
#   - mkdir -p the install root (default: /opt/metabot-core)
#   - rsync the built package (dist/, static/, package.json, bin/) to the install dir
#   - install production deps in the install dir
#   - chown to the run user
#   - install /etc/metabot-core/env (idempotent: never overwrites)
#   - install systemd unit, daemon-reload, enable + (re)start
#
# What this script DOES NOT do:
#   - Set up TLS termination or an SSO/auth reverse proxy. Both are OPTIONAL and
#     left to the operator (see the note printed at the end). The personal
#     edition authenticates with a local API token out of the box.
#   - Install Node or any system package — assumes Node >=22.19 is already on PATH.
#
# Configurable via environment:
#   USER_NAME              run user             (default: ${SUDO_USER:-$USER})
#   METABOT_CORE_DATA_DIR  data root            (default: $HOME/.metabot-core/data)
#   INSTALL_DIR            install root         (default: /opt/metabot-core)
#
# Usage (as root, on the deploy host):
#     sudo bash deploy/install.sh
#
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "error: must run as root (try sudo)" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

USER_NAME="${USER_NAME:-${SUDO_USER:-$USER}}"
USER_HOME="$(eval echo "~$USER_NAME")"
DATA_DIR="${METABOT_CORE_DATA_DIR:-$USER_HOME/.metabot-core/data}"
INSTALL_DIR="${INSTALL_DIR:-/opt/metabot-core}"
ETC_DIR="/etc/metabot-core"
SERVICE_NAME="metabot-core"

if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  echo "error: user '$USER_NAME' does not exist on this host" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not on PATH; install Node >=22.19 before running this script" >&2
  exit 2
fi

if ! node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22 && (b>19 || (b===19 && c>=0))) ? 0 : 1)'; then
  echo "error: Node >=22.19 is required; found $(node --version)" >&2
  exit 2
fi

if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "error: $PKG_DIR/dist not found — run 'npm run build' in $PKG_DIR first" >&2
  exit 2
fi

echo "==> Ensuring data dir at $DATA_DIR"
mkdir -p "$DATA_DIR"
chown "$USER_NAME":"$USER_NAME" "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "==> Ensuring install dir at $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo "==> Syncing package to $INSTALL_DIR"
# Sync built artifacts + manifest. Deps install fresh inside $INSTALL_DIR
# (next step) — we can't rsync the workspace-root node_modules because npm
# workspaces hoists shared deps there, and rsyncing $PKG_DIR/node_modules
# alone only catches the few packages that didn't hoist (e.g. better-sqlite3).
rsync -a --delete \
  --exclude='.git' \
  --exclude='tests' \
  --exclude='*.tsbuildinfo' \
  --exclude='coverage' \
  "$PKG_DIR/dist/" "$INSTALL_DIR/dist/"
rsync -a "$PKG_DIR/package.json" "$INSTALL_DIR/package.json"
rsync -a "$PKG_DIR/bin/" "$INSTALL_DIR/bin/"

# Web UI static assets (built by packages/web-ui via `vite build` into
# $PKG_DIR/static). Optional: only synced when present, so a server-only
# build still installs cleanly. The server resolves `static/` relative to
# its dist root (sibling of dist/), matching this layout.
if [[ -d "$PKG_DIR/static" ]]; then
  echo "==> Syncing web UI static assets to $INSTALL_DIR/static"
  rsync -a --delete "$PKG_DIR/static/" "$INSTALL_DIR/static/"
fi

chown -R "$USER_NAME":"$USER_NAME" "$INSTALL_DIR"

echo "==> Installing production deps in $INSTALL_DIR (as $USER_NAME)"
# Run as $USER_NAME so installed binaries / cache ownership stay consistent.
# Use `npm install --omit=dev` (no lockfile inside $INSTALL_DIR yet).
sudo -u "$USER_NAME" bash -c "cd '$INSTALL_DIR' && npm install --omit=dev --no-audit --no-fund"

echo "==> Writing $ETC_DIR/env (idempotent — keeps existing values)"
mkdir -p "$ETC_DIR"
if [[ ! -f "$ETC_DIR/env" ]]; then
  cat > "$ETC_DIR/env" <<EOF
METABOT_CORE_HOST=127.0.0.1
METABOT_CORE_PORT=9200
METABOT_CORE_DATA_DIR=$DATA_DIR
METABOT_CORE_AUDIT_DIR=$DATA_DIR/audit
# Optional: restrict the Web UI to a specific host header. Leave unset to
# serve the UI on any host (e.g. http://localhost:9200). Set this to your
# public hostname if you front the server with a reverse proxy.
# METABOT_CORE_UI_HOST=your-metabot-host.example.com
LOG_FORMAT=json
EOF
  chmod 640 "$ETC_DIR/env"
  chown root:"$USER_NAME" "$ETC_DIR/env"
else
  echo "    (existing $ETC_DIR/env left untouched)"
fi

echo "==> Installing systemd unit"
UNIT_SRC="$PKG_DIR/deploy/systemd/metabot-core.service"
UNIT_DST="/etc/systemd/system/$SERVICE_NAME.service"
# Patch ExecStart to point at the installed dist/index.js so the unit works
# regardless of where the package was built from.
NODE_BIN="$(command -v node)"
sed \
  -e "s|^ExecStart=.*|ExecStart=$NODE_BIN $INSTALL_DIR/dist/index.js|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=$DATA_DIR|" \
  -e "s|^User=.*|User=$USER_NAME|" \
  -e "s|^ReadWritePaths=.*|ReadWritePaths=$DATA_DIR|" \
  "$UNIT_SRC" > "$UNIT_DST"
# Inject EnvironmentFile only if missing (sed -i appended once)
if ! grep -q "EnvironmentFile=-$ETC_DIR/env" "$UNIT_DST"; then
  sed -i "s|^EnvironmentFile=.*|EnvironmentFile=-$ETC_DIR/env|" "$UNIT_DST"
fi

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"

echo "==> Starting $SERVICE_NAME"
systemctl restart "$SERVICE_NAME.service"

echo "==> Done"
echo "Health: curl -fsS http://127.0.0.1:9200/health"
echo "Logs:   journalctl -u $SERVICE_NAME -f"
echo "Admin bootstrap token (first run only): cat $DATA_DIR/admin-bootstrap-token.txt"
echo ""
echo "The server now listens on http://127.0.0.1:9200 and authenticates with a"
echo "local API token — no further setup is required for personal use."
echo ""
echo "Optional, left to the operator:"
echo "  - TLS / public hostname: put a reverse proxy (Caddy, nginx, Traefik, ...)"
echo "    in front of 127.0.0.1:9200 and point it at your own domain. If you do,"
echo "    set METABOT_CORE_UI_HOST in $ETC_DIR/env to that hostname and restart."
echo "  - SSO: an OIDC/SSO reverse proxy (e.g. oauth2-proxy) can sit in front of"
echo "    the server, but is NOT required — the built-in token auth is sufficient."
