/**
 * Thin HTTP client over `cli-core`'s shared `request()` scoped to the
 * `/api/t5t/cli/*` write + read surface (server-side handlers in
 * `packages/server/src/t5t/t5t-routes.ts`).
 *
 * URL + token resolution comes from `cli-core`'s `loadConfig()` —
 * `METABOT_CORE_URL` (default `http://localhost:9200`,
 * dedicated front-door domain after the P4-MR6 pivot) +
 * `METABOT_CORE_TOKEN` env or `~/.metabot-core/token` first line.
 */

import { loadConfig, request, type Config } from '@xvirobotics/cli-core';

export interface T5tClient {
  cfg: Config;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

export function loadT5tClient(env: NodeJS.ProcessEnv = process.env): T5tClient {
  const cfg = loadConfig(env);
  return {
    cfg,
    get<T = unknown>(path: string): Promise<T> {
      return request<T>(cfg, { method: 'GET', path });
    },
    post<T = unknown>(path: string, body: unknown): Promise<T> {
      return request<T>(cfg, { method: 'POST', path, body });
    },
  };
}

// ---- typed request/response shapes -------------------------------------
// These mirror the server's `t5t/types.ts` + `t5t-routes.ts` payloads. The
// CLI doesn't import from `@xvirobotics/metabot-core-server` because that
// package is server-only (better-sqlite3 native deps) and not part of the
// CLI dependency graph. Keep these shapes minimal — they cover only what
// the CLI subcommands display or chain.

export interface WhoamiResponse {
  source: 'web' | 'cli';
  canonicalEmail: string;
  botName: string;
  role: 'admin' | 'member';
}

export interface T5tProject {
  slug: string;
  name?: string;
  leaderEmail?: string;
  allowedUsers?: string[];
  status?: string;
  lastSeenAt?: string;
}

export interface T5tEntry {
  docId: string;
  entryId?: string;
  project: string;
  author?: string;
  authorCanonical?: string;
  date?: string;
  items: string[];
  retracts?: string | null;
  createdAt?: string;
}

export interface T5tAnomaly {
  project: string;
  reason: string;
  detail?: string;
}

export interface BoardResponse {
  generatedAt: string;
  projects: T5tProject[];
  recentEntries: T5tEntry[];
  anomalies: T5tAnomaly[];
}

export interface StatusResponse {
  generatedAt: string;
  projects: T5tProject[];
  anomalies: T5tAnomaly[];
}

export interface T5tTopFiveItem {
  project: string;
  itemId: string;
  text: string;
  status: 'open' | 'done' | 'removed';
  author: string;
  authorCanonical: string;
  replaces: string | null;
  createdAt: string;
  docId: string;
}

export interface ProjectDetailResponse {
  project: T5tProject;
  entries: T5tEntry[];
  feedback: unknown[];
  wipBoard: unknown[];
  topFive: T5tTopFiveItem[];
}

export interface DeleteSmokeProjectResponse {
  slug: string;
  removed: {
    projects: number;
    entries: number;
    feedback: number;
    goals: number;
    evaluators: number;
    bottlenecks: number;
    wip: number;
    topfive: number;
    total: number;
  };
}
