/**
 * `metabot t5t` subcommands. Thin wrappers over `/api/t5t/cli/*` routes
 * (server: `packages/server/src/t5t/t5t-routes.ts`, MR3).
 *
 *   metabot t5t board
 *   metabot t5t status
 *   metabot t5t whoami
 *   metabot t5t projects [list|show <slug>]
 *   metabot t5t push <project> <YYYY-MM-DD> "<item1>" ["<item2>" ...]
 *   metabot t5t feedback <entryDocId> "<comment>" [--mentions @alice,@bob]
 *   metabot t5t goal <project> "<text>"
 *   metabot t5t evaluator <project> add|remove <email>
 *   metabot t5t bottleneck <project> "<text>"
 *   metabot t5t wip <project> <evaluatorId> "<title>"
 *   metabot t5t top5 <project> add "<text>"
 *   metabot t5t top5 <project> done|reopen|remove <itemId>
 *   metabot t5t top5 <project> list
 *   metabot t5t kill <project>
 *   metabot t5t reopen <project>
 *
 * Auth: `METABOT_CORE_TOKEN` env or `~/.metabot-core/token` (resolved by
 * `cli-core`'s `loadConfig`). Owner-auth errors (`owner_required`) surface
 * directly from the server's 403 response — caller sees a clean message.
 */

import { parseArgs, print } from '@xvirobotics/cli-core';
import {
  loadT5tClient,
  type BoardResponse,
  type DeleteSmokeProjectResponse,
  type ProjectDetailResponse,
  type StatusResponse,
  type T5tClient,
  type WhoamiResponse,
} from './t5t-client.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage(): string {
  return `metabot t5t — daily team status portal (board / projects / entries / feedback)

Subcommands:
  board                                          Pretty-print the full board
  status                                         Lightweight: projects + anomalies, no entries
  whoami                                         Echo caller's resolved identity
  projects [list|show <slug>]                    List all projects, or one in detail
  push <project> <YYYY-MM-DD> "<item>" [...]     Append a daily entry; project auto-created if new
  feedback <entryDocId> "<comment>" [--mentions @a,@b]
                                                 Add feedback under an entry
  goal <project> "<text>"                        Set/update the project goal           (owner-auth)
  evaluator <project> add|remove <email>         Manage project evaluators             (owner-auth)
  bottleneck <project> "<text>"                  Set the current bottleneck            (owner-auth)
  wip <project> <evaluatorId> "<title>"          Add a WIP item under an evaluator col (owner-auth)
  kill <project>                                 Mark a project as killed              (owner-auth)
  reopen <project>                               Reopen a killed project               (owner-auth)
  delete <smoke-project>                         Hard-delete your own smoke test project
  top5 <project> add "<text>"                    Add a Top-5 todo item                 (owner-auth)
  top5 <project> done|reopen|remove <itemId>     Flip status of an existing Top-5 item (owner-auth)
  top5 <project> list                            List the current Top-5 items

Env:
  METABOT_CORE_URL    metabot-core base URL (default http://localhost:9200)
  METABOT_CORE_TOKEN  Bearer token (or ~/.metabot-core/token first line)
`;
}

function need(label: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`metabot t5t: ${label} required\n\n${usage()}`);
  }
  return value.trim();
}

async function cmdBoard(client: T5tClient): Promise<void> {
  const resp = await client.get<BoardResponse>('/api/t5t/cli/board');
  print(resp);
}

async function cmdStatus(client: T5tClient): Promise<void> {
  const resp = await client.get<StatusResponse>('/api/t5t/cli/status');
  print(resp);
}

async function cmdWhoami(client: T5tClient): Promise<void> {
  const resp = await client.get<WhoamiResponse>('/api/t5t/cli/whoami');
  print(resp);
}

async function cmdProjects(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const sub = positional[0] || 'list';
  if (sub === 'list') {
    // No dedicated list endpoint — derive from board.
    const resp = await client.get<BoardResponse>('/api/t5t/cli/board');
    print({ projects: resp.projects });
    return;
  }
  if (sub === 'show') {
    const slug = need('<slug>', positional[1]);
    const resp = await client.get<ProjectDetailResponse>(
      `/api/t5t/cli/project/${encodeURIComponent(slug)}`,
    );
    print(resp);
    return;
  }
  throw new Error(`metabot t5t projects: unknown sub '${sub}' (expected list|show)`);
}

async function cmdPush(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const date = need('<YYYY-MM-DD>', positional[1]);
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`metabot t5t push: <YYYY-MM-DD> expected, got '${date}'`);
  }
  const items = positional.slice(2).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new Error('metabot t5t push: at least one "<item>" required');
  }
  const resp = await client.post('/api/t5t/cli/push', { project, date, items });
  print(resp);
}

async function cmdFeedback(client: T5tClient, args: string[]): Promise<void> {
  const { positional, flags } = parseArgs(args);
  const onEntry = need('<entryDocId>', positional[0]);
  const comment = need('"<comment>"', positional[1]);
  const mentionsRaw = typeof flags.mentions === 'string' ? flags.mentions : '';
  const mentions = mentionsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const resp = await client.post('/api/t5t/cli/feedback', { onEntry, comment, mentions });
  print(resp);
}

async function cmdGoal(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const text = need('"<text>"', positional[1]);
  const resp = await client.post('/api/t5t/cli/goal', { project, text });
  print(resp);
}

async function cmdEvaluator(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const action = (positional[1] || '').trim();
  const email = need('<email>', positional[2]);
  if (action !== 'add' && action !== 'remove') {
    throw new Error(
      `metabot t5t evaluator: action must be 'add' or 'remove', got '${action || ''}'`,
    );
  }
  // Server contract: each evaluator-doc carries its own `met` flag; we use it
  // to express add (met=true) vs remove (met=false). The evaluatorId is the
  // email itself (canonical, stable, comparable to leaderEmail).
  const resp = await client.post('/api/t5t/cli/evaluator', {
    project,
    evaluatorId: email,
    description: action === 'add' ? `added by metabot t5t cli` : `removed by metabot t5t cli`,
    met: action === 'add',
  });
  print(resp);
}

async function cmdBottleneck(client: T5tClient, args: string[]): Promise<void> {
  const { positional, flags } = parseArgs(args);
  const project = need('<project>', positional[0]);
  if (flags.clear === true) {
    const resp = await client.post('/api/t5t/cli/bottleneck', { project, clear: true });
    print(resp);
    return;
  }
  const text = need('"<text>"', positional[1]);
  const resp = await client.post('/api/t5t/cli/bottleneck', { project, text });
  print(resp);
}

async function cmdKill(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const resp = await client.post('/api/t5t/cli/kill', { project });
  print(resp);
}

async function cmdReopen(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const resp = await client.post('/api/t5t/cli/reopen', { project });
  print(resp);
}

async function cmdDelete(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<smoke-project>', positional[0]);
  if (!project.toLowerCase().startsWith('smoke')) {
    throw new Error('metabot t5t delete: only smoke* test projects can be hard-deleted');
  }
  const resp = await client.post<DeleteSmokeProjectResponse>('/api/t5t/cli/delete', { project });
  print(resp);
}

async function cmdTopFive(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const action = (positional[1] || '').trim();
  if (!action) {
    throw new Error(
      `metabot t5t top5: action required (add|done|reopen|remove|list)`,
    );
  }
  if (action === 'list') {
    const detail = await client.get<ProjectDetailResponse>(
      `/api/t5t/cli/project/${encodeURIComponent(project)}`,
    );
    print({ topFive: detail.topFive });
    return;
  }
  if (action === 'add') {
    const text = need('"<text>"', positional[2]);
    const resp = await client.post('/api/t5t/cli/topfive', { project, text });
    print(resp);
    return;
  }
  if (action === 'done' || action === 'reopen' || action === 'remove') {
    const itemId = need('<itemId>', positional[2]);
    const status = action === 'done' ? 'done' : action === 'reopen' ? 'open' : 'removed';
    const resp = await client.post('/api/t5t/cli/topfive', { project, itemId, status });
    print(resp);
    return;
  }
  throw new Error(
    `metabot t5t top5: unknown action '${action}' (expected add|done|reopen|remove|list)`,
  );
}

async function cmdWip(client: T5tClient, args: string[]): Promise<void> {
  const { positional } = parseArgs(args);
  const project = need('<project>', positional[0]);
  const evaluatorId = need('<evaluatorId>', positional[1]);
  const description = need('"<title>"', positional[2]);
  const resp = await client.post('/api/t5t/cli/wip', {
    project,
    evaluatorId,
    description,
  });
  print(resp);
}

export async function run(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    process.stdout.write(usage());
    return;
  }

  // Resolve the client lazily so `--help` and unknown-subcommand paths don't
  // require a token. Every subcommand below issues at least one HTTP call,
  // so missing-token surfaces as a clean `loadConfig` error message.
  const client = loadT5tClient();

  switch (sub) {
    case 'board':
      return cmdBoard(client);
    case 'status':
      return cmdStatus(client);
    case 'whoami':
      return cmdWhoami(client);
    case 'projects':
      return cmdProjects(client, rest);
    case 'push':
      return cmdPush(client, rest);
    case 'feedback':
      return cmdFeedback(client, rest);
    case 'goal':
      return cmdGoal(client, rest);
    case 'evaluator':
      return cmdEvaluator(client, rest);
    case 'bottleneck':
      return cmdBottleneck(client, rest);
    case 'wip':
      return cmdWip(client, rest);
    case 'kill':
      return cmdKill(client, rest);
    case 'reopen':
      return cmdReopen(client, rest);
    case 'delete':
      return cmdDelete(client, rest);
    case 'top5':
      return cmdTopFive(client, rest);
    default:
      process.stderr.write(`metabot t5t: unknown subcommand '${sub}'\n\n`);
      process.stdout.write(usage());
      process.exit(2);
  }
}
