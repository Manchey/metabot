# @xvirobotics/metabot-core-web-ui

Browser console for the metabot-core archive — read-only viewer for
meta-memory documents and the skill hub.

> Read-only MVP (Phase 1 of the Web UI). Creating / editing / deleting
> documents stays on the `metabot memory` / `metabot skills` CLI.

## Stack

- React 18 + React Router 6, built with Vite.
- `marked` + `DOMPurify` for Markdown rendering (sanitized before injection).
- Stored HTML documents render inside a sandboxed `<iframe srcdoc>` —
  **no `allow-scripts`**; stored HTML is treated as data, not code.

## Dev

```bash
# from repo root, deps are workspace-hoisted:
npm install

# run the metabot-core server somewhere reachable on :9200, then:
cd packages/web-ui
npm run dev          # Vite dev server on http://localhost:5173
```

The dev server proxies `/api`, `/admin`, and `/health` to
`http://127.0.0.1:9200`, so a local metabot-core server works without CORS
fuss. In the personal edition the SPA is served by metabot-core itself behind
a single API token — run it locally or behind your own reverse proxy; see the
Runtime expectations section.

## Build

```bash
npm run build        # tsc && vite build
```

Output goes to **`../server/static/`** (not a local `dist/`). That directory
is gitignored and is what `packages/server` serves when a request arrives on
the `METABOT_CORE_UI_HOST` hostname. `deploy/install.sh` rsyncs it to
`/opt/metabot-core/static/` when present.

## Runtime expectations

- The SPA only works when reached via the host configured in
  `METABOT_CORE_UI_HOST` on the server. Other hosts (e.g. raw IP probes
  inside the deploy box) return 404 for `/` and `/assets/*` by design —
  the API stays reachable everywhere, the UI does not. For a local
  self-hosted setup set `METABOT_CORE_UI_HOST=localhost` (the CLI's
  default `METABOT_CORE_URL` is then `http://localhost:9200`); for a
  remote box use your own hostname, e.g.
  `METABOT_CORE_UI_HOST=your-metabot-host.example.com`.
- **Auth: a single API token (no SSO).** The personal edition does not
  assume any corporate SSO or oauth2-proxy front door. The SPA talks to
  metabot-core using the same Bearer token as the CLI; run metabot-core
  locally or behind your own reverse proxy and protect it with the token
  in `~/.metabot-core/token` / `METABOT_CORE_TOKEN`. If a `/api/*` reply
  is 401, supply or refresh that token.
- On first server start, the admin bootstrap token is written once to
  `~/.metabot-core/data/admin-bootstrap-token.txt` by the default deployment.
  Paste it into the browser login screen, then optionally save it as
  `~/.metabot-core/token` (mode `0600`) for CLI use. The browser keeps its copy
  in local storage and forgets it on **sign out**.

## Routes

| Path | View |
|---|---|
| `/` | folder tree + last 50 documents |
| `/memory/*path` | folder listing or document viewer (deep-linkable) |
| `/skills` | published skill registry |
| `/skills/:name` | rendered SKILL.md + metadata sidebar |
| `/t5t` | t5t board — projects, recent entries, anomaly zone |
| `/t5t/:slug` | project detail — goal, evaluators, bottleneck, WIP, timeline, feedback |
| `/search?q=…` | unified memory + skill full-text search |
