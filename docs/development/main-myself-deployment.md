# main-myself integration and deployment

This branch integrates upstream Personal Edition 1.3.2 (`916637e`), the fork's
thread/session work through `3146244`, question-card work through `1a27833`,
and the Feishu WebSocket watchdog (`73c1ef6`). Upstream supplies the current
conversation address, session/resume, Core, CLI and Web Console architecture.

Retained local behavior:

- Every initial Feishu message starts an independent topic. Replies, commands,
  cards, files and scheduled work keep their topic destination. Existing topics
  continue to use their original root message. Legacy `oc_...:om_...` keys
  migrate automatically, preserving engine ownership, accounting and newer
  canonical records. Switching engines still starts a new native engine session.
- `/ps [3h|7d|30m]` reports activity and running tasks.
- `@Bot /noMention [on|off|status]` aliases the persistent `/group-reply` setting.
  Current upstream ownership checks and per-Agent group scope apply.
- Task reactions, context utilization bars, shutdown notices and scheduler
  `originMessageId` support remain available.
- Question cards use native Schema 2.0 callback buttons. Multiple choices are
  staged and committed explicitly; typed numbers or custom text also work.
  Answers use question text, following the current SDK contract. The obsolete
  header-based answer keys from the old feature branch are superseded.
- The additional socket watchdog complements the current SDK's pong and
  handshake timeouts and escalates an unrecoverable connection to service restart.

## This host

- Checkout: `/home/jiaqili/workspace/metabot`, branch `main-myself`.
- Bridge: existing system `metabot.service`, API on localhost port 9100.
- Core: user `metabot-core.service`, port 9200 on localhost; user lingering
  enabled so it starts at boot without an interactive login.
- Core database: `~/.metabot-core/data/central.db`.
- Local owner token: `~/.metabot-core/token`; bridge token:
  `~/.metabot-core/bridge-token`. Both files must stay mode 0600.
- Existing `.env`, `bots.json`, working directories and session stores are
  retained. The bridge uses the explicitly configured Codex CLI executable.
- The old Bridge `/web/` entry redirects to the Core Console `/chat`.
- Legacy memory documents are copied into Core with IDs, paths, content and
  timestamps preserved. The original database remains untouched.

## Verification and rollback

Run `npm run build`, `npm test` and `npm run lint` before deployment. On this
Ubuntu 20.04 host, native module builds need `CC=clang CXX=clang++` because the
installed GCC 9 does not accept Node 24's C++20 compiler option.

Verify both `/api/health` on Bridge and `/health` on Core, authenticated memory
reads, the Web Console and Codex execution/resume through an isolated Web bot.
Never use production Feishu messages for smoke tests without authorization.

The pre-upgrade snapshot is
`~/.metabot-backups/20261020-before-main-myself/`. It contains configuration,
SQLite online backups, the old compiled bridge and the old service unit.
The old dependency tree is also retained there after deployment.

For rollback, stop both services, restore the old code revision, compiled
bridge, dependency directory and configuration from that snapshot, and restart
the Bridge. The Core database is separate from the legacy memory database;
retain it if new documents have been created since the upgrade. Do not overwrite
live state databases with the snapshot unless rolling back their contents is
explicitly intended.
