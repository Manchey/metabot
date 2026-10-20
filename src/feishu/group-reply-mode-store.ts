import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { Logger } from '../utils/logger.js';

export type FeishuGroupReplyMode = 'mention' | 'all';

export class FeishuGroupReplyModeStore {
  private db: Database.Database;

  constructor(logger: Logger, dbPath?: string) {
    const dataDir = process.env.SESSION_STORE_DIR || path.join(os.homedir(), '.metabot');
    const resolvedPath = dbPath || path.join(dataDir, 'feishu-group-reply-modes.db');
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_group_reply_modes (
        bot_name TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('mention', 'all')),
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(bot_name, chat_id)
      )
    `);
    logger.info({ dbPath: resolvedPath }, 'Feishu group reply mode store initialized');
  }

  get(botName: string, chatId: string): FeishuGroupReplyMode | undefined {
    const row = this.db
      .prepare('SELECT mode FROM feishu_group_reply_modes WHERE bot_name = ? AND chat_id = ?')
      .get(botName, chatId) as { mode: FeishuGroupReplyMode } | undefined;
    return row?.mode;
  }

  set(botName: string, chatId: string, mode: FeishuGroupReplyMode, updatedBy: string): void {
    this.db
      .prepare(
        `INSERT INTO feishu_group_reply_modes (bot_name, chat_id, mode, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(bot_name, chat_id) DO UPDATE SET
           mode = excluded.mode,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .run(botName, chatId, mode, updatedBy, Date.now());
  }

  close(): void {
    this.db.close();
  }
}
