/**
 * Codex session lister -- read-only helper for the Feishu `/resume` command.
 *
 * Codex records resumable threads in `$CODEX_HOME/state_5.sqlite` and mirrors
 * full transcripts under `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 * Prefer the SQLite index because it already carries cwd/title/preview and is
 * what `codex exec resume` uses for cwd-filtered resume discovery.
 */

import { existsSync, openSync, readSync, statSync, closeSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { SessionSummary } from '../claude/session-lister.js';

interface CodexThreadRow {
  id: string;
  rollout_path?: string;
  updated_at?: number;
  updated_at_ms?: number;
  title?: string;
  first_user_message?: string;
  preview?: string;
}

export function codexHomeDir(homeDir: string = os.homedir()): string {
  return process.env.CODEX_HOME || path.join(homeDir, '.codex');
}

export function listCodexSessions(opts: {
  workingDirectory: string;
  currentSessionId?: string;
  limit?: number;
  homeDir?: string;
  previewMaxLen?: number;
}): SessionSummary[] {
  const { workingDirectory, currentSessionId, limit = 10, homeDir = os.homedir(), previewMaxLen = 80 } = opts;

  const codexHome = codexHomeDir(homeDir);
  const indexed = listCodexSessionsFromStateDb({
    codexHome,
    workingDirectory,
    currentSessionId,
    limit,
    previewMaxLen,
  });
  if (indexed.length > 0) return indexed;

  return listCodexSessionsFromJsonl({
    codexHome,
    workingDirectory,
    currentSessionId,
    limit,
    previewMaxLen,
  });
}

function listCodexSessionsFromStateDb(opts: {
  codexHome: string;
  workingDirectory: string;
  currentSessionId?: string;
  limit: number;
  previewMaxLen: number;
}): SessionSummary[] {
  const dbPath = path.join(opts.codexHome, 'state_5.sqlite');
  if (!existsSync(dbPath)) return [];

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `
      SELECT id, rollout_path, updated_at, updated_at_ms, title, first_user_message, preview
      FROM threads
      WHERE archived = 0 AND cwd = ?
      ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
      LIMIT ?
    `,
      )
      .all(path.resolve(opts.workingDirectory), opts.limit) as CodexThreadRow[];

    return rows.map((row) => {
      const filePath = row.rollout_path ? resolveRolloutPath(opts.codexHome, row.rollout_path) : undefined;
      const stat = filePath ? safeStat(filePath) : undefined;
      const preview = row.preview || row.first_user_message || row.title || '';
      return {
        sessionId: row.id,
        preview: truncatePreview(preview, opts.previewMaxLen) || '(no preview)',
        lastActive: (row.updated_at_ms ?? (row.updated_at ?? 0) * 1000) || stat?.mtimeMs || 0,
        sizeBytes: stat?.size ?? 0,
        isCurrent: row.id === opts.currentSessionId,
      };
    });
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function listCodexSessionsFromJsonl(opts: {
  codexHome: string;
  workingDirectory: string;
  currentSessionId?: string;
  limit: number;
  previewMaxLen: number;
}): SessionSummary[] {
  const sessionsDir = path.join(opts.codexHome, 'sessions');
  const files = findJsonlFiles(sessionsDir);
  const cwd = path.resolve(opts.workingDirectory);
  const summaries: SessionSummary[] = [];

  for (const filePath of files) {
    const meta = readCodexJsonlMeta(filePath, opts.previewMaxLen);
    if (!meta?.sessionId || path.resolve(meta.cwd || '') !== cwd) continue;
    const stat = safeStat(filePath);
    if (!stat) continue;
    summaries.push({
      sessionId: meta.sessionId,
      preview: meta.preview || '(no preview)',
      lastActive: stat.mtimeMs,
      sizeBytes: stat.size,
      isCurrent: meta.sessionId === opts.currentSessionId,
    });
  }

  summaries.sort((a, b) => b.lastActive - a.lastActive);
  return summaries.slice(0, opts.limit);
}

function resolveRolloutPath(codexHome: string, rolloutPath: string): string {
  return path.isAbsolute(rolloutPath) ? rolloutPath : path.join(codexHome, rolloutPath);
}

function safeStat(filePath: string): { size: number; mtimeMs: number } | undefined {
  try {
    const stat = statSync(filePath);
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

function findJsonlFiles(root: string): string[] {
  const out: string[] = [];
  try {
    if (!existsSync(root)) return out;
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = safeDirOrFileStat(fullPath);
        if (!stat) continue;
        if (stat.isDirectory) stack.push(fullPath);
        else if (entry.endsWith('.jsonl')) out.push(fullPath);
      }
    }
  } catch {
    return out;
  }
  return out;
}

function safeDirOrFileStat(filePath: string): { isDirectory: boolean } | undefined {
  try {
    const stat = statSync(filePath);
    return { isDirectory: stat.isDirectory() };
  } catch {
    return undefined;
  }
}

function readCodexJsonlMeta(
  filePath: string,
  previewMaxLen: number,
): { sessionId?: string; cwd?: string; preview?: string } | undefined {
  const CHUNK = 64 * 1024;
  let fd: number | undefined;
  let buffered = '';
  let offset = 0;
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let preview: string | undefined;

  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(CHUNK);
    let scanned = 0;
    while (scanned < 8 * CHUNK) {
      const bytes = readSync(fd, buf, 0, CHUNK, offset);
      if (bytes <= 0) break;
      offset += bytes;
      scanned += bytes;
      buffered += buf.toString('utf8', 0, bytes);
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const rec = parseJson(line);
        if (!rec) continue;
        if (rec.type === 'session_meta') {
          sessionId = typeof rec.payload?.id === 'string' ? rec.payload.id : sessionId;
          cwd = typeof rec.payload?.cwd === 'string' ? rec.payload.cwd : cwd;
        }
        preview = preview || extractCodexUserPreview(rec, previewMaxLen);
        if (sessionId && cwd && preview) return { sessionId, cwd, preview };
      }
      if (bytes < CHUNK) break;
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  return sessionId || cwd || preview ? { sessionId, cwd, preview } : undefined;
}

function parseJson(line: string): any | undefined {
  try {
    const trimmed = line.trim();
    return trimmed ? JSON.parse(trimmed) : undefined;
  } catch {
    return undefined;
  }
}

function extractCodexUserPreview(rec: any, previewMaxLen: number): string | undefined {
  if (rec.type === 'event_msg' && rec.payload?.type === 'user_message' && typeof rec.payload.message === 'string') {
    return truncatePreview(rec.payload.message, previewMaxLen);
  }
  if (rec.type === 'response_item' && rec.payload?.role === 'user') {
    const content = rec.payload.content;
    if (Array.isArray(content)) {
      const text = content.find((item: any) => item?.type === 'input_text' && typeof item.text === 'string')?.text;
      if (text) return truncatePreview(text, previewMaxLen);
    }
  }
  return undefined;
}

function truncatePreview(text: string, previewMaxLen: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > previewMaxLen ? collapsed.slice(0, previewMaxLen) + '...' : collapsed;
}
