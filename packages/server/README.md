# @xvirobotics/metabot-core-server

Memory + skill-hub HTTP server for MetaBot. Single process, single SQLite,
single bind on `127.0.0.1:9200`. In the personal edition you run it locally
(default `http://localhost:9200`) or on your own box behind a reverse proxy
of your choice (e.g. Caddy at `https://your-metabot-host.example.com`),
protected by a single API token — no SSO or corporate VPN required.

## Quick start (dev)

From the metabot-core repo root:

```bash
npm install                                  # workspace install
npm -w @xvirobotics/metabot-core-server build
npm -w @xvirobotics/metabot-core-server test
METABOT_CORE_DATA_DIR=/tmp/mc-dev \
  node packages/server/dist/index.js
```

On first start the server bootstraps an admin credential and writes the
one-time bearer token to `<data-dir>/admin-bootstrap-token.txt` (mode 0600).
Save it — it is never displayed again.

## Configuration (env)

| Var | Default | Notes |
|---|---|---|
| `METABOT_CORE_HOST` | `127.0.0.1` | Bind address. Loopback-only by default; put your own reverse proxy in front to expose it. |
| `METABOT_CORE_PORT` | `9200` | TCP port. |
| `METABOT_CORE_DATA_DIR` | `~/.metabot-core/data` | SQLite + audit live here. |
| `METABOT_CORE_AUDIT_DIR` | `$METABOT_CORE_DATA_DIR/audit` | Override audit dir. |
| `METABOT_PUBLIC_DISTRIBUTION` | _unset_ | `/cli/*` + `/install/*` install endpoints are token-gated by default; set `1`/`true` to serve them anonymously. Only when you self-distribute and your build embeds no secrets. |
| `METABOT_CORE_AUDIT_ENABLED` | `true` | Set `false` to disable audit writes. |
| `METABOT_CORE_INSTANCE_NAME` | _pkg name_ | Surfaced in `/api/manifest`. |
| `METABOT_CORE_UI_HOST` | _unset_ | Optional hostname restriction for the SPA Web UI. Unset serves the SPA on any Host; the default `127.0.0.1` bind keeps it local-only. |
| `METABOT_CORE_UI_ALLOWED_EMAILS` | _unset_ | Optional comma-separated email whitelist for the proxy-header web-identity path (`X-Forwarded-Email`), only relevant if you put your own SSO proxy in front. Lowercased + trimmed. Unset/empty → web-identity disabled (token-only). See "Optional proxy-header identity" below. |
| `LOG_FORMAT` | _auto_ | `json` for prod; defaults to `pino-pretty` on a TTY. |
| `LOG_LEVEL` | `info` | pino level. |

## API

Open routes (no auth):

```
GET  /health          → { ok, uptime, version }
GET  /api/manifest    → { schemaVersion, instance, capabilities }
```

Authenticated routes use `Authorization: Bearer <token>`. Admin routes
(`role: 'admin'`):

```
POST   /admin/credentials/issue
POST   /admin/credentials/revoke
GET    /admin/credentials
GET    /admin/audit?date=YYYY-MM-DD[&principal=&op=]
```

Memory routes:

```
GET    /api/memory/folders[?prefix=/users/...]
GET    /api/memory/folders/tree
GET    /api/memory/folders/:idOrPath
POST   /api/memory/folders
DELETE /api/memory/folders/:idOrPath
GET    /api/memory/documents[?folder_id=|prefix=&limit=&offset=]
POST   /api/memory/documents
GET    /api/memory/documents/:idOrPath
PATCH  /api/memory/documents/:idOrPath
DELETE /api/memory/documents/:idOrPath
GET    /api/memory/search?q=&limit=
```

Skill routes:

```
GET    /api/skills
GET    /api/skills/search?q=
GET    /api/skills/:name
POST   /api/skills/:name/publish      ← requires publishSkill or admin
DELETE /api/skills/:name              ← admin only
```

Paths may be referenced as either internal id (uuid) or absolute path
starting with `/`. The router URL-decodes the segment, so e.g.
`/api/memory/documents/%2Fusers%2Fdkj%2Fnotes%2Fhello` resolves the
document at `/users/dkj/notes/hello`.

### Document `content_type`

Documents carry a `content_type` field. v1 whitelist:

- `text/markdown` (default when omitted)
- `text/html`

`POST` / `PATCH` / `PUT` accept an optional `content_type` in the request
body; unknown values → `400 unsupported_content_type`. Existing databases
get the column added on first boot via an idempotent migration; all
pre-existing documents default to `text/markdown`. The capability is
advertised on `/api/manifest` as
`capabilities.content_types: ["text/markdown", "text/html"]` so clients
can feature-detect.

FTS still indexes raw `content`, so HTML documents are searchable by both
their tags and text. Snippet rendering may include `<mark>` tags inside
HTML markup — acceptable for v1; not in scope to fix here.

## Web UI (host-based dispatch)

The server can also serve the personal-edition single-page Web UI from
`packages/server/static/`. Serving is enabled by default on the loopback-bound
server and can optionally be host-gated:

- With `METABOT_CORE_UI_HOST` unset, `GET` requests on non-API paths fall
  through to the SPA for any Host header; the default bind remains
  `127.0.0.1`.
- Set `METABOT_CORE_UI_HOST=<hostname>` to restrict SPA serving to one host.
  The check is case-insensitive and ignores port. Requests on any other host
  behave as a pure API server.
- POST/PATCH/DELETE/etc. on non-API paths still return `404` — static-serve
  never accepts uploads.
- `/health` and `/api/manifest` stay reachable on the UI host so the SPA
  can self-bootstrap.
- Assets under `/assets/*` are served with
  `Cache-Control: public, max-age=31536000, immutable`; everything else
  (including `index.html` and the SPA fallback) uses `Cache-Control: no-cache`.
- Unknown paths fall back to `index.html` (SPA routing). If `index.html`
  is missing the response is `404 ui_not_installed` — install the UI bundle
  separately (a dedicated install step lands in a follow-up).
- Defense-in-depth: traversal attempts are stopped by `node:URL`
  normalization plus a `path.resolve()` boundary check against
  `STATIC_DIR`. The MIME map is an allowlist
  (`.html`, `.js`, `.css`, `.svg`, `.ico`, `.map`, `.png`, `.jpg`, `.jpeg`,
  `.woff2`, `.json`); anything else falls back to `application/octet-stream`.

Default unset → the SPA is enabled for the local personal edition. If you
front it with a reverse proxy, set `METABOT_CORE_UI_HOST` to the public
hostname and restart `metabot-core`.

## Optional proxy-header identity (web-identity)

The personal edition is **token-only by default** — the Bearer API token is
the single credential and no SSO is assumed. If you *choose* to put your own
identity-aware reverse proxy in front of the server, it can optionally inject
an `X-Forwarded-Email` header that the server treats as a second, read-only
auth chain alongside the CLI/bot Bearer path. This is **opt-in and
default-off**, gated by `METABOT_CORE_UI_ALLOWED_EMAILS`. Most self-hosted
users never need it.

- **Bearer always wins.** The web path is only entered when there is *no*
  `Authorization: Bearer` header. A forged `X-Forwarded-Email` cannot
  downgrade or impersonate a real token. (Only trust this header if your own
  proxy sets it — never expose the server directly with it enabled.)
- **Whitelist.** `METABOT_CORE_UI_ALLOWED_EMAILS` is a comma-separated
  list, lowercased + trimmed at load. The inbound `X-Forwarded-Email` is
  lowercased before the membership check (case-insensitive). Empty/unset →
  the email header is ignored entirely and the server is Bearer-only.
- **Synthetic credential.** A whitelisted email mints an in-memory,
  never-persisted credential: `id: web:<email>`, `role: member`,
  `readableNamespaces: ['/']` (full read), `writableNamespaces: []`,
  `publishSkill: false`, `synthetic: true`, `authSource: 'web'`.
- **Structural read-only fork (primary gate).** A web identity can ONLY
  reach these GET routes; **everything else returns `404 not_found`**
  (not 403 — route existence is not leaked):
  - `GET /api/memory/folders`, `/api/memory/folders/tree`,
    `/api/memory/folders/:idOrPath`
  - `GET /api/memory/documents`, `/api/memory/documents/:idOrPath`
  - `GET /api/memory/search`
  - `GET /api/skills`, `/api/skills/search`, `/api/skills/:name`
  - (`/health`, `/api/manifest` are open to everyone)
  Defense-in-depth: (1) the structural route fork, (2) `role:member` +
  empty `writableNamespaces`, (3) the email whitelist env.
- **Auth failures.** `X-Forwarded-Email` missing (and no Bearer) →
  `401 missing_token`; present but not whitelisted →
  `403 web_identity_forbidden`.
- **Audit.** Web requests log `credentialId=web:<email>`, `role=member`,
  plus `authSource:'web'` — greppable without overloading the ACL role
  enum.

If you do run an identity-aware proxy (e.g. oauth2-proxy or any SSO gateway)
in front, the recommended shape is: let it inject `X-Forwarded-Email` only on
authenticated browser sessions, keep `/health` and `/api/manifest` unauthed
so the SPA can self-bootstrap, and steer `Authorization: Bearer*` traffic
straight to the backend so the CLI/bot token path bypasses the proxy
entirely. This is entirely optional — the default deployment needs no proxy
at all.

## ACL

```
canRead(cred, path):
  admin → true
  /shared/* → true
  cred.readableNamespaces matches → true
  otherwise false

canWrite(cred, path):
  admin → true
  cred.writableNamespaces matches → true
  otherwise false

canPublishSkill(cred):
  admin → true
  cred.publishSkill → true
  otherwise false
```

Defaults when issuing a member:
- `writableNamespaces`: `[/users/<botName>]`
- `readableNamespaces`: `[/shared, /users/<botName>]`
- `publishSkill`: false

## CLI: `central-admin`

```
central-admin issue   --bot <name> --owner <name> [--role admin|member]
                      [--writable <ns,ns>] [--readable <ns,ns>]
                      [--publish-skill] [--notes <text>]
central-admin revoke  --id <credentialId>
central-admin list
central-admin audit   --date YYYY-MM-DD [--principal <id>] [--op <op>]
```

Auth: `METABOT_CORE_ADMIN_TOKEN` env or `--token <token>`. URL via
`METABOT_CORE_URL` (default `http://localhost:9200`; set your own remote
host if metabot-core runs elsewhere) or `--url`.

## Deployment

For a simple self-hosted deployment you only need the server itself running
on `127.0.0.1:9200` with a data dir and an API token — no proxy, no SSO. See
`deploy/` for optional helpers:

- `systemd/metabot-core.service` — example systemd unit (hardened with
  NoNewPrivileges + ProtectSystem=strict + PrivateTmp + ReadWritePaths).
  Set `User=`, `WorkingDirectory=`, and `METABOT_CORE_DATA_DIR` to your own
  paths.
- `install.sh` — idempotent installer. Run after `npm install && npm run
  build` from the package dir. Installs the metabot-core unit, enables +
  starts the service.

TLS and SSO are **out of scope** for the personal edition and not required:
the server listens on localhost with token auth. If you want to expose it on
your own hostname, put any reverse proxy (Caddy, nginx, …) in front to
terminate TLS, and optionally an SSO/identity proxy (e.g. oauth2-proxy) — both
are entirely your choice and bring-your-own.

## Tests

`npm test` runs the full vitest suite:

- `tests/auth.test.ts` — credential issue/revoke/lookup/cache + bootstrap
- `tests/memory.test.ts` — folder + document CRUD with namespace ACL
- `tests/skills.test.ts` — publish/list/search/delete + publish-acl
- `tests/audit.test.ts` — every authed request logged JSONL
- `tests/e2e.test.ts` — full flow over real HTTP: bootstrap → issue → member
  writes own ns / 403 elsewhere → revoke
