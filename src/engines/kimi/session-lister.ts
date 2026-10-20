import type { SessionSummary } from '../claude/session-lister.js';
import { KimiDaemonClient, type KimiWireSession } from './daemon-client.js';

export interface KimiSessionListerClient {
  listSessions(cwd?: string): Promise<KimiWireSession[]>;
}

/** Read-only Kimi Code 0.27 session discovery for Feishu `/resume`. */
export async function listKimiSessions(opts: {
  workingDirectory: string;
  currentSessionId?: string;
  limit?: number;
  previewMaxLen?: number;
  executable?: string;
  serverUrl?: string;
  apiKey?: string;
  client?: KimiSessionListerClient;
}): Promise<SessionSummary[]> {
  const {
    workingDirectory,
    currentSessionId,
    limit = 10,
    previewMaxLen = 80,
    client = new KimiDaemonClient({
      executable: opts.executable,
      serverUrl: opts.serverUrl,
      apiKey: opts.apiKey,
    }),
  } = opts;
  try {
    const sessions = await client.listSessions(workingDirectory);
    return sessions
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, limit)
      .map((session) => ({
        sessionId: session.id,
        preview: truncatePreview(session.last_prompt || session.title || '', previewMaxLen) || '(no preview)',
        lastActive: Date.parse(session.updated_at) || 0,
        // Kimi's Server API intentionally abstracts its storage layout. The
        // picker does not need a byte size, so keep the cross-engine field at 0.
        sizeBytes: 0,
        isCurrent: session.id === currentSessionId,
      }));
  } catch {
    return [];
  }
}

function truncatePreview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}
