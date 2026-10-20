import type { Credential } from '../auth/credentials.js';
import type { T5tStore } from './t5t-store.js';
import type {
  BoardResponse,
  FeedbackEntry,
  ProjectDetailResponse,
  WhoamiResponse,
} from './types.js';
import {
  isValidationError,
  parseCliBottleneck,
  parseCliEvaluator,
  parseCliFeedback,
  parseCliGoal,
  parseCliPush,
  parseCliTopFive,
  parseCliWip,
} from './contracts.js';
import { requireOwner } from './owner-auth.js';

export interface RouteResult {
  status: number;
  body: unknown;
}

function err(status: number, error: string): RouteResult {
  return { status, body: { error } };
}

/**
 * Wrap a store mutation so any `Object.assign(Error, { statusCode })` it
 * throws maps to a `RouteResult`; anything else rethrows to the server's
 * generic 500 handler.
 */
function guarded<T>(fn: () => T): RouteResult {
  try {
    return { status: 200, body: fn() };
  } catch (e) {
    const sc = (e as { statusCode?: number }).statusCode;
    if (typeof sc === 'number') {
      return err(sc, (e as Error).message || 'error');
    }
    throw e;
  }
}

const BOARD_RECENT_LIMIT = 25;

/**
 * GET /api/t5t/board — list all visible projects + a global recent-entries
 * feed (newest-first) + computed anomalies. Open read: any authenticated
 * caller (Bearer member or web-identity) sees the same shape. v1 has no
 * per-project visibility filter; that arrives in MR3+ along with `private`
 * folders.
 */
export function getBoard(store: T5tStore, _cred: Credential): RouteResult {
  const projects = store.listProjects();
  const recentEntries = store.recentEntries(BOARD_RECENT_LIMIT);
  const anomalies = store.computeAnomalies();
  const body: BoardResponse = {
    generatedAt: new Date().toISOString(),
    projects,
    recentEntries,
    anomalies,
  };
  return { status: 200, body };
}

/**
 * GET /api/t5t/projects/:slug — project detail with entries (newest-first),
 * feedback (oldest-first per `listFeedbackForEntry`), and the WIP board
 * grouped by evaluator. Open read for any authenticated caller; owner-auth
 * only gates the write paths.
 */
export function getProject(
  store: T5tStore,
  slug: string,
  _cred: Credential,
): RouteResult {
  const decoded = (slug || '').trim();
  if (!decoded) return err(400, 'slug_required');
  const project = store.getProject(decoded);
  if (!project) return err(404, 'project_not_found');

  const entries = store.listEntriesByProject(decoded);
  // Feedback per entry is fetched once and concatenated; the UI groups them
  // back by `onEntry`. Order across entries is implicit (entry order) but
  // within each entry the list is chronological — matches FeedbackThread's
  // rendering shape in MR4.
  const feedback: FeedbackEntry[] = [];
  for (const entry of entries) {
    for (const fb of store.listFeedbackForEntry(entry.docId)) {
      feedback.push(fb);
    }
  }
  const wipBoard = store.computeWipBoard(decoded);
  const topFive = store.listTopFiveItems(decoded);

  const body: ProjectDetailResponse = {
    project,
    entries,
    feedback,
    wipBoard,
    topFive,
  };
  return { status: 200, body };
}

/**
 * POST /api/t5t/projects/:slug/kill (web)  and  POST /api/t5t/cli/kill (CLI)
 *   — append a new project doc with `status='killed'`. Owner-auth required
 * (project leader, allowedUsers, or admin). Append-only: prior project docs
 * stay intact; latest-doc-wins surfaces the killed state. Idempotent.
 *
 * Web shape takes `slug` from the URL; CLI shape takes `project` from the
 * body. Both converge on `store.killProject(slug, cred)`.
 */
export function postKillProject(
  store: T5tStore,
  slug: string,
  cred: Credential,
): RouteResult {
  const decoded = (slug || '').trim();
  if (!decoded) return err(400, 'slug_required');
  const gate = ownerGate(store, decoded, cred);
  if (gate) return gate;
  return guarded(() => store.killProject(decoded, cred));
}

export function postCliKill(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  if (!project) return err(400, 'project_required');
  const gate = ownerGate(store, project, cred);
  if (gate) return gate;
  return guarded(() => store.killProject(project, cred));
}

export function postCliReopen(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  if (!project) return err(400, 'project_required');
  const gate = ownerGate(store, project, cred);
  if (gate) return gate;
  return guarded(() => store.reopenProject(project, cred));
}

/**
 * POST /api/t5t/cli/delete — hard-delete smoke-test projects only. This is
 * intentionally narrower than kill: real project history remains append-only,
 * but users can clean up their own `smoke*` test projects from the board.
 */
export function postCliDelete(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  if (!project) return err(400, 'project_required');
  if (!project.toLowerCase().startsWith('smoke')) {
    return err(400, 'only_smoke_projects_can_be_deleted');
  }
  const gate = ownerGate(store, project, cred);
  if (gate) return gate;
  return guarded(() => store.purgeSmokeProject(project));
}

/**
 * POST /api/t5t/feedback — append a feedback comment under an entry. The
 * `author`/`from` field is ALWAYS stamped server-side from `cred.botName`;
 * any client-supplied `author` / `from` in the body is ignored. This mirrors
 * the agent-routes pattern and prevents identity spoofing through the web
 * write surface.
 */
export function postFeedback(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const onEntry = typeof body.onEntry === 'string' ? body.onEntry.trim() : '';
  if (!onEntry) return err(400, 'on_entry_required');
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!comment) return err(400, 'comment_required');
  const mentions = Array.isArray(body.mentions)
    ? body.mentions.filter((m): m is string => typeof m === 'string')
    : [];

  return guarded(() => store.appendFeedback({ onEntry, comment, mentions }, cred));
}

// ---- CLI write/read handlers (Bearer-only; wired in server.ts) ----

/**
 * POST /api/t5t/cli/push — append a daily T5T entry. If the target project
 * slug does not exist yet it is auto-created with the caller as leader
 * (`leaderEmail = cred.botName`). This is the only write path that creates a
 * project; goal/evaluator/bottleneck/wip require an existing, owned project.
 */
export function postCliPush(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliPush(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  return guarded(() => {
    if (!store.getProject(parsed.project)) {
      store.appendProject(
        { slug: parsed.project, leaderEmail: cred.botName },
        cred,
      );
    }
    return store.appendEntry(
      {
        project: parsed.project,
        items: parsed.items,
        date: parsed.date,
        retracts: parsed.retracts,
      },
      cred,
    );
  });
}

function ownerGate(
  store: T5tStore,
  slug: string,
  cred: Credential,
): RouteResult | null {
  const project = store.getProject(slug);
  if (!project) return err(404, 'project_not_found');
  const failure = requireOwner(project, cred);
  if (failure) return err(failure.status, failure.error);
  return null;
}

export function postCliGoal(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliGoal(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  const gate = ownerGate(store, parsed.project, cred);
  if (gate) return gate;
  return guarded(() => store.appendGoal(parsed, cred));
}

export function postCliEvaluator(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliEvaluator(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  const gate = ownerGate(store, parsed.project, cred);
  if (gate) return gate;
  return guarded(() =>
    store.appendEvaluator(
      {
        project: parsed.project,
        evaluatorId: parsed.evaluatorId,
        description: parsed.description ?? '',
        met: parsed.met,
      },
      cred,
    ),
  );
}

export function postCliBottleneck(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliBottleneck(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  const gate = ownerGate(store, parsed.project, cred);
  if (gate) return gate;
  return guarded(() =>
    store.appendBottleneck(
      { project: parsed.project, text: parsed.text, clear: parsed.clear },
      cred,
    ),
  );
}

export function postCliWip(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliWip(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  const gate = ownerGate(store, parsed.project, cred);
  if (gate) return gate;
  return guarded(() =>
    store.appendWipItem(
      {
        project: parsed.project,
        evaluatorId: parsed.evaluatorId,
        description: parsed.description,
        status: parsed.status,
        wipId: parsed.wipId,
      },
      cred,
    ),
  );
}

/**
 * POST /api/t5t/topfive (web) and POST /api/t5t/cli/topfive (CLI) — append a
 * top-five todo item. Owner-gated on `project`. Body shape: `{ project, text?,
 * itemId?, status? }`. Without `itemId` a new item is created (text required);
 * with `itemId` the existing item's status / text is updated.
 */
export function postTopFive(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliTopFive(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  const gate = ownerGate(store, parsed.project, cred);
  if (gate) return gate;
  return guarded(() =>
    store.appendTopFive(
      {
        project: parsed.project,
        text: parsed.text,
        itemId: parsed.itemId,
        status: parsed.status,
      },
      cred,
    ),
  );
}

export function postCliTopFive(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  return postTopFive(store, body, cred);
}

export function postCliFeedback(
  store: T5tStore,
  body: Record<string, unknown>,
  cred: Credential,
): RouteResult {
  const parsed = parseCliFeedback(body);
  if (isValidationError(parsed)) return err(parsed.status, parsed.error);
  return guarded(() =>
    store.appendFeedback(
      {
        onEntry: parsed.onEntry,
        comment: parsed.comment,
        mentions: parsed.mentions,
      },
      cred,
    ),
  );
}

/** GET /api/t5t/cli/board — identical payload to the web board. */
export function getCliBoard(store: T5tStore, cred: Credential): RouteResult {
  return getBoard(store, cred);
}

/**
 * GET /api/t5t/cli/status — board minus the recent-entries feed. Lightweight
 * dashboard for `metabot t5t status`: projects + anomalies only.
 */
export function getCliStatus(store: T5tStore, _cred: Credential): RouteResult {
  return {
    status: 200,
    body: {
      generatedAt: new Date().toISOString(),
      projects: store.listProjects(),
      anomalies: store.computeAnomalies(),
    },
  };
}

/**
 * GET /api/t5t/cli/whoami — echo the caller's resolved identity. `cred.botName`
 * is the canonical author identity (email-shape for the t5t-replacement token
 * trunks issues). Never reads anything from the request body.
 */
export function getCliWhoami(cred: Credential): RouteResult {
  const body: WhoamiResponse = {
    source: cred.authSource === 'web' ? 'web' : 'cli',
    canonicalEmail: cred.botName,
    botName: cred.botName,
    role: cred.role === 'admin' ? 'admin' : 'member',
  };
  return { status: 200, body };
}

/**
 * GET /api/t5t/cli/project/:slug — same detail shape as the web
 * `getProject`. Reused so the CLI and web detail views never diverge.
 */
export function getCliProject(
  store: T5tStore,
  slug: string,
  cred: Credential,
): RouteResult {
  return getProject(store, slug, cred);
}

/**
 * GET /api/t5t/cli/wip/:slug/:wipId — single WIP item (latest doc wins).
 * `slug` scopes the lookup so a wipId from another project can't be fetched
 * by guessing the id.
 */
export function getCliWipItem(
  store: T5tStore,
  slug: string,
  wipId: string,
  _cred: Credential,
): RouteResult {
  const s = (slug || '').trim();
  const id = (wipId || '').trim();
  if (!s || !id) return err(400, 'slug_and_wip_id_required');
  const item = store.getWipById(id);
  if (!item || item.project !== s) return err(404, 'wip_not_found');
  return { status: 200, body: item };
}
