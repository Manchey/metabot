import type { BotConfigBase } from '../config.js';
import type { Logger } from '../utils/logger.js';
import type { IncomingMessage } from '../types.js';
import type { IMessageSender } from './message-sender.interface.js';
import { resolveEngineName, SessionManager } from '../engines/index.js';
import type { EngineName } from '../engines/index.js';
import { MemoryClient } from '../memory/memory-client.js';
import { AuditLogger } from '../utils/audit-logger.js';
import type { DocSync } from '../sync/doc-sync.js';
import type { ActivityStore } from '../api/activity-store.js';
import { addNoMentionChat, removeNoMentionChat, isNoMentionChat } from '../utils/no-mention-store.js';

/** Helper function type for sending thread-aware notice replies. */
type ReplyNotice = (title: string, content: string, color?: string) => Promise<void>;

export class CommandHandler {
  private docSync: DocSync | null = null;
  private activityStore: ActivityStore | null = null;

  constructor(
    private config: BotConfigBase,
    private logger: Logger,
    private sender: IMessageSender,
    private sessionManager: SessionManager,
    private memoryClient: MemoryClient,
    private audit: AuditLogger,
    private getRunningTask: (sessionKey: string) => { startTime: number } | undefined,
    private stopTask: (sessionKey: string) => void,
    private getRunningTasksInfo: () => Array<{ chatId: string; userId?: string; startTime: number }>,
  ) {}

  /** Set the doc sync service (optional, only available for Feishu bots). */
  setDocSync(docSync: DocSync): void {
    this.docSync = docSync;
  }

  /** Set the activity store (for /ps command). */
  setActivityStore(store: ActivityStore): void {
    this.activityStore = store;
  }

  /** Returns true if the message was handled as a command, false otherwise. */
  async handle(msg: IncomingMessage): Promise<boolean> {
    const { text } = msg;
    if (!text.startsWith('/')) return false;

    const { userId, chatId, messageId, rootId } = msg;
    const [cmd] = text.split(/\s+/);

    this.audit.log({ event: 'command', botName: this.config.name, chatId, userId, prompt: cmd });

    // Compute sessionKey for thread-aware session management
    const threadKey = rootId || messageId;
    const sessionKey = `${chatId}:${threadKey}`;

    // Use thread reply if available (for Feishu)
    const replyNotice: ReplyNotice = async (title, content, color) => {
      if (this.sender.replyTextNotice && messageId) {
        await this.sender.replyTextNotice(messageId, title, content, color, true);
      } else {
        await this.sender.sendTextNotice(chatId, title, content, color);
      }
    };

    switch (cmd.toLowerCase()) {
      case '/help':
        await replyNotice('📖 Help', [
          '**Available Commands:**',
          '`/reset` - Clear session, start fresh',
          '`/stop` - Abort current running task',
          '`/status` - Show current session info',
          '`/model` - Show current engine/model; `/model list` - Available options',
          '`/model claude`, `/model kimi`, or `/model codex` - Switch engine (resets session)',
          '`/model <name>` - Set model for current engine',
          '`/noMention` - Skip @mention requirement in this chat (2-member groups)',
          '`/ps` - Show conversation history (default: 1 day)',
          '`/ps 3h` / `/ps 7d` / `/ps 30m` - Customize time range',
          '`/memory` - Memory document commands',
          '`/help` - Show this help message',
          '',
          '**Usage:**',
          'Send any text message to start a conversation with the configured agent engine.',
          'Each chat has an independent session with a fixed working directory.',
          '',
          '**Memory Commands:**',
          '`/memory list` - Show folder tree',
          '`/memory search <query>` - Search documents',
          '`/memory status` - Server health check',
          '',
          '**Sync Commands:**',
          '`/sync` - Sync MetaMemory to Feishu Wiki',
          '`/sync status` - Show sync status',
        ].join('\n'));
        return true;

      case '/reset':
        this.sessionManager.resetSession(sessionKey);
        await replyNotice('✅ Session Reset', 'Conversation cleared. Working directory preserved.', 'green');
        return true;

      case '/stop': {
        const task = this.getRunningTask(sessionKey);
        if (task) {
          this.audit.log({ event: 'task_stopped', botName: this.config.name, chatId, userId, durationMs: Date.now() - task.startTime });
          this.stopTask(sessionKey);
          await replyNotice('🛑 Stopped', 'Current task has been aborted.', 'orange');
        } else {
          await replyNotice('ℹ️ No Running Task', 'There is no task to stop.', 'blue');
        }
        return true;
      }

      case '/status': {
        const session = this.sessionManager.getSession(sessionKey);
        const isRunning = !!this.getRunningTask(sessionKey);
        const botEngine = resolveEngineName(this.config);
        const activeEngine = session.engine ?? botEngine;
        const defaultModel = this.defaultModelForEngine(activeEngine) || '_default_';
        const activeModel = session.model || defaultModel;
        await replyNotice('📊 Status', [
          `**User:** \`${userId}\``,
          `**Engine:** \`${activeEngine}\`${session.engine ? ' (session override)' : ''}`,
          `**Working Directory:** \`${session.workingDirectory}\``,
          `**Session:** ${session.sessionId ? `\`${session.sessionId.slice(0, 8)}...\`` : '_None_'}`,
          `**Model:** \`${activeModel}\`${session.model ? ' (session override)' : ''}`,
          `**Running:** ${isRunning ? 'Yes ⏳' : 'No'}`,
        ].join('\n'));
        return true;
      }

      case '/memory': {
        const args = text.slice('/memory'.length).trim();
        await this.handleMemoryCommand(sessionKey, args, replyNotice);
        return true;
      }

      case '/sync': {
        const args = text.slice('/sync'.length).trim();
        await this.handleSyncCommand(sessionKey, args, replyNotice);
        return true;
      }

      case '/model': {
        const args = text.slice('/model'.length).trim();
        await this.handleModelCommand(sessionKey, args, replyNotice);
        return true;
      }

      case '/ps': {
        const args = text.slice('/ps'.length).trim();
        await this.handlePsCommand(args, replyNotice);
        return true;
      }

      case '/noMention': {
        const args = text.slice('/noMention'.length).trim().toLowerCase();
        if (args === 'off' || args === '0' || args === 'false') {
          removeNoMentionChat(this.config.name, chatId);
          await replyNotice('✅ @Mention Required', 'This chat now requires @mention to trigger the bot.', 'green');
        } else {
          const already = isNoMentionChat(this.config.name, chatId);
          if (already) {
            await replyNotice('ℹ️ Already Active', 'This chat already skips the @mention requirement.\nUse `/noMention off` to restore it.', 'blue');
          } else {
            addNoMentionChat(this.config.name, chatId);
            await replyNotice('✅ No @Mention Needed', 'You can now message the bot directly in this chat without @mention.\nUse `/noMention off` to restore the requirement.', 'green');
          }
        }
        return true;
      }

      default:
        // Unrecognized /xxx commands — not handled here, pass through to Claude
        return false;
    }
  }

  private async handleMemoryCommand(sessionKey: string, args: string, replyNotice: ReplyNotice): Promise<void> {
    const [subCmd, ...rest] = args.split(/\s+/);

    if (!subCmd) {
      await replyNotice(
        '📝 Memory',
        'Usage:\n- `/memory list` — Show folder tree\n- `/memory search <query>` — Search documents\n- `/memory status` — Health check',
      );
      return;
    }

    try {
      switch (subCmd.toLowerCase()) {
        case 'list': {
          const tree = await this.memoryClient.listFolderTree();
          const formatted = this.memoryClient.formatFolderTree(tree);
          await replyNotice('📂 Memory Folders', formatted);
          break;
        }
        case 'search': {
          const query = rest.join(' ').trim();
          if (!query) {
            await replyNotice('📝 Memory', 'Usage: `/memory search <query>`');
            return;
          }
          const results = await this.memoryClient.search(query);
          const formatted = this.memoryClient.formatSearchResults(results);
          await replyNotice(`🔍 Search: ${query}`, formatted);
          break;
        }
        case 'status': {
          const health = await this.memoryClient.health();
          await replyNotice(
            '📝 Memory Status',
            `Status: ${health.status}\nDocuments: ${health.document_count}\nFolders: ${health.folder_count}`,
            'green',
          );
          break;
        }
        default:
          await replyNotice('📝 Memory', `Unknown sub-command: \`${subCmd}\`\nUse \`/memory\` for help.`, 'orange');
      }
    } catch (err: any) {
      this.logger.error({ err, sessionKey }, 'Memory command error');
      await replyNotice('❌ Memory Error', `Failed to connect to memory server: ${err.message}`, 'red');
    }
  }

  private async handleSyncCommand(sessionKey: string, args: string, replyNotice: ReplyNotice): Promise<void> {
    if (!this.docSync) {
      await replyNotice('❌ Sync Unavailable', 'Wiki sync is not configured for this bot.', 'red');
      return;
    }

    const [subCmd] = args.split(/\s+/);

    if (!subCmd) {
      // Default: trigger full sync
      if (this.docSync.isSyncing()) {
        await replyNotice('⏳ Sync In Progress', 'A sync is already running. Please wait.', 'orange');
        return;
      }

      await replyNotice('🔄 Sync Started', 'Syncing MetaMemory documents to Feishu Wiki...', 'blue');

      try {
        const result = await this.docSync.syncAll();
        const lines = [
          `**Created:** ${result.created}`,
          `**Updated:** ${result.updated}`,
          `**Skipped:** ${result.skipped} (unchanged)`,
          `**Deleted:** ${result.deleted}`,
          `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
        ];
        if (result.errors.length > 0) {
          lines.push('', `**Errors (${result.errors.length}):**`);
          for (const err of result.errors.slice(0, 5)) {
            lines.push(`- ${err}`);
          }
          if (result.errors.length > 5) {
            lines.push(`- ... and ${result.errors.length - 5} more`);
          }
        }
        const color = result.errors.length > 0 ? 'orange' : 'green';
        await replyNotice('✅ Sync Complete', lines.join('\n'), color);
      } catch (err: any) {
        this.logger.error({ err, sessionKey }, 'Sync command error');
        await replyNotice('❌ Sync Failed', err.message, 'red');
      }
      return;
    }

    switch (subCmd.toLowerCase()) {
      case 'status': {
        const stats = this.docSync.getStats();
        const spaceId = stats.wikiSpaceId || 'Not configured';
        await replyNotice('📊 Sync Status', [
          `**Wiki Space:** \`${spaceId}\``,
          `**Synced Documents:** ${stats.documentCount}`,
          `**Synced Folders:** ${stats.folderCount}`,
          `**Currently Syncing:** ${this.docSync.isSyncing() ? 'Yes' : 'No'}`,
        ].join('\n'));
        break;
      }
      default:
        await replyNotice('📝 Sync', 'Usage:\n- `/sync` — Sync all documents to Feishu Wiki\n- `/sync status` — Show sync status', 'blue');
    }
  }

  private async handlePsCommand(args: string, replyNotice: ReplyNotice): Promise<void> {
    if (!this.activityStore) {
      await replyNotice('❌ Activity Store Unavailable', 'The activity store is not configured for this bot.', 'red');
      return;
    }

    // Parse time suffix: /ps 3h, /ps 7d, /ps 30m, /ps (default 1d)
    let sinceMs = 24 * 60 * 60 * 1000; // default: 1 day
    if (args) {
      const match = args.match(/^(\d+)(m|h|d)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const unit = match[2];
        sinceMs = unit === 'm' ? num * 60 * 1000 : unit === 'h' ? num * 60 * 60 * 1000 : num * 24 * 60 * 60 * 1000;
      } else {
        await replyNotice('📝 PS', 'Usage:\n- `/ps` — Last 1 day (default)\n- `/ps 3h` — Last 3 hours\n- `/ps 7d` — Last 7 days\n- `/ps 30m` — Last 30 minutes', 'blue');
        return;
      }
    }

    const since = Date.now() - sinceMs;
    const summary = this.activityStore.getSummary({ botName: this.config.name, since });
    const runningTasks = this.getRunningTasksInfo();

    // Resolve user names if possible
    const allUserIds = [...summary.users.map(u => u.userId), ...runningTasks.filter(t => t.userId).map(t => t.userId!)];
    const nameMap = new Map<string, string>();
    if (this.sender.resolveUserNames && allUserIds.length > 0) {
      try {
        const resolved = await this.sender.resolveUserNames(allUserIds);
        for (const [id, name] of resolved) {
          nameMap.set(id, name);
        }
      } catch {
        // Fall back to raw IDs
      }
    }
    const displayName = (id: string) => nameMap.get(id) || id;

    // Format time period
    const periodLabel = sinceMs >= 24 * 60 * 60 * 1000
      ? `${Math.round(sinceMs / (24 * 60 * 60 * 1000))} day(s)`
      : sinceMs >= 60 * 60 * 1000
        ? `${Math.round(sinceMs / (60 * 60 * 1000))} hour(s)`
        : `${Math.round(sinceMs / (60 * 1000))} minute(s)`;

    const lines: string[] = [];
    lines.push(`**Period:** Last ${periodLabel}`);
    lines.push(`**Tasks:** ${summary.totalTasks} (${summary.completedTasks} completed, ${summary.failedTasks} failed)`);
    lines.push(`**Total Cost:** $${summary.totalCostUsd.toFixed(2)}`);

    if (summary.users.length > 0) {
      lines.push('');
      lines.push('| User | # | Last Prompt | Cost |');
      lines.push('|------|---|-------------|------|');
      for (const u of summary.users.slice(0, 20)) {
        const name = displayName(u.userId);
        const prompt = u.lastPrompt ? (u.lastPrompt.length > 40 ? u.lastPrompt.slice(0, 37) + '...' : u.lastPrompt) : '-';
        lines.push(`| ${name} | ${u.taskCount} | ${prompt} | $${u.totalCostUsd.toFixed(2)} |`);
      }
      if (summary.users.length > 20) {
        lines.push(`| ... and ${summary.users.length - 20} more | | | |`);
      }
    }

    if (runningTasks.length > 0) {
      lines.push('');
      lines.push('**Running Tasks:**');
      for (const t of runningTasks) {
        const name = t.userId ? displayName(t.userId) : 'unknown';
        const durationMs = Date.now() - t.startTime;
        const duration = durationMs >= 60 * 60 * 1000
          ? `${Math.round(durationMs / (60 * 60 * 1000))}h`
          : durationMs >= 60 * 1000
            ? `${Math.round(durationMs / (60 * 1000))}m`
            : `${Math.round(durationMs / 1000)}s`;
        lines.push(`- ${name} in \`${t.chatId}\` (${duration})`);
      }
    }

    if (summary.totalTasks === 0 && runningTasks.length === 0) {
      lines.push('');
      lines.push('_No activity in this period._');
    }

    await replyNotice('📊 Activity Summary', lines.join('\n'));
  }

  private async handleModelCommand(sessionKey: string, args: string, replyNotice: ReplyNotice): Promise<void> {
    const session = this.sessionManager.getSession(sessionKey);
    const botEngine = resolveEngineName(this.config);
    const activeEngine = session.engine ?? botEngine;
    const botDefault = this.defaultModelForEngine(activeEngine);

    // No args — show current model
    if (!args) {
      const active = session.model || botDefault || '_default_';
      const exampleModels = this.exampleModelsForEngine(activeEngine);
      const lines = [
        `**Engine:** \`${activeEngine}\`${session.engine ? ' (session override)' : ''}`,
        `**Active:** \`${active}\`${session.model ? ' (session override)' : ''}`,
        `**Bot default:** \`${botDefault || '_unset_'}\``,
        '',
        'Usage:',
        '- `/model list` — Show available engines + models',
        '- `/model claude`, `/model kimi`, or `/model codex` — Switch engine (resets session)',
        `- \`/model <name>\` — Set session model (e.g. ${exampleModels})`,
        '- `/model reset` — Clear overrides, use bot defaults',
      ];
      await replyNotice('🤖 Model', lines.join('\n'));
      return;
    }

    const normalized = args.toLowerCase();

    // Engine switch — /model claude, /model kimi, or /model codex
    if (isEngineName(normalized)) {
      if (activeEngine === normalized) {
        await replyNotice(
          'ℹ️ Already using ' + normalized,
          `This chat is already on the \`${normalized}\` engine.`,
          'blue',
        );
        return;
      }
      this.sessionManager.setSessionEngine(sessionKey, normalized);
      await replyNotice(
        `✅ Engine switched to ${normalized}`,
        [
          `Next message will run on the **${normalized}** engine.`,
          '',
          '_Session ID and model override cleared — a fresh conversation starts on the next turn._',
          this.authTipForEngine(normalized),
        ].join('\n'),
        'green',
      );
      return;
    }

    // List available models
    if (normalized === 'list' || normalized === 'ls') {
      const active = session.model || botDefault;
      const claudeModels = [
        { id: 'claude-opus-4-7', label: 'Opus 4.7', note: 'Most capable · 200k context' },
        { id: 'claude-opus-4-7[1m]', label: 'Opus 4.7 (1M)', note: '1M context window' },
        { id: 'claude-opus-4-6', label: 'Opus 4.6', note: '200k context' },
        { id: 'claude-opus-4-6[1m]', label: 'Opus 4.6 (1M)', note: '1M context window' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', note: 'Balanced · 200k context' },
        { id: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M)', note: '1M context window' },
        { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'Fastest · 200k context' },
      ];
      const kimiModels = [
        { id: 'kimi-for-coding', label: 'Kimi for Coding', note: 'Subscription default · 256k context · thinking' },
        { id: 'kimi-k2', label: 'Kimi K2', note: 'Legacy coding model' },
      ];
      const codexModels = [
        { id: 'gpt-5.4-codex', label: 'GPT-5.4 Codex', note: 'Recommended Codex coding model' },
        { id: 'gpt-5.4', label: 'GPT-5.4', note: 'General flagship model' },
        { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', note: 'Legacy Codex coding model' },
      ];
      const models = activeEngine === 'kimi' ? kimiModels : activeEngine === 'codex' ? codexModels : claudeModels;
      const header = activeEngine === 'kimi'
        ? '**Available Kimi models:**'
        : activeEngine === 'codex'
          ? '**Common Codex models:**'
          : '**Available Claude models:**';
      const lines = [
        `**Current engine:** \`${activeEngine}\`${session.engine ? ' (session override)' : ''}`,
        '',
        '**Engines:** `/model claude`, `/model kimi`, or `/model codex` to switch.',
        '',
        header,
        '',
      ];
      for (const m of models) {
        const marker = m.id === active ? ' ✅' : '';
        lines.push(`- \`${m.id}\` — ${m.label} · ${m.note}${marker}`);
      }
      lines.push('');
      if (activeEngine === 'claude') {
        lines.push('_Tip: append `[1m]` to a model name to enable the 1M context window. Only Opus 4.7/4.6 and Sonnet 4.6 support it._');
      } else if (activeEngine === 'codex') {
        lines.push('_Tip: leave unset to use the Codex CLI default from `~/.codex/config.toml`._');
      } else {
        lines.push('_Tip: leave unset to use the kimi-cli default (recommended for subscription users — the server picks the best available)._');
      }
      lines.push('Use `/model <name>` to set the model for the current engine.');
      await replyNotice('🤖 Available Models', lines.join('\n'));
      return;
    }

    // Reset — clear overrides (both engine AND model)
    if (normalized === 'reset' || normalized === 'clear' || normalized === 'default') {
      this.sessionManager.setSessionModel(sessionKey, undefined);
      this.sessionManager.setSessionEngine(sessionKey, undefined);
      const fallback = botDefault || '_default_';
      await replyNotice(
        '✅ Overrides Cleared',
        `Session engine and model overrides cleared. Using bot defaults: engine \`${botEngine}\`, model \`${fallback}\`.`,
        'green',
      );
      return;
    }

    // Set the model (use only the first token, ignore trailing junk)
    const newModel = args.split(/\s+/)[0];
this.sessionManager.setSessionModel(sessionKey, newModel, activeEngine);
    await replyNotice(
      '✅ Model Set',
      `Session model set to \`${newModel}\` on engine \`${activeEngine}\`. It will take effect on the next message.`,
      'green',
    );
  }

  private defaultModelForEngine(engine: EngineName): string | undefined {
    switch (engine) {
      case 'claude':
        return this.config.claude.model;
      case 'kimi':
        return this.config.kimi?.model;
      case 'codex':
        return this.config.codex?.model || this.config.codex?.displayModel;
    }
  }

  private exampleModelsForEngine(engine: EngineName): string {
    switch (engine) {
      case 'claude':
        return '`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`';
      case 'kimi':
        return '`kimi-for-coding`, `kimi-k2`';
      case 'codex':
        return '`gpt-5.4-codex`, `gpt-5.4`, `gpt-5.2-codex`';
    }
  }

  private authTipForEngine(engine: EngineName): string {
    switch (engine) {
      case 'claude':
        return '_Make sure Claude Code is authenticated (`claude login`)._';
      case 'kimi':
        return '_Make sure `kimi login` has been completed on this host._';
      case 'codex':
        return '_Make sure Codex CLI is authenticated (`codex login`) or configured with an API key._';
    }
  }
}

function isEngineName(value: string): value is EngineName {
  return value === 'claude' || value === 'kimi' || value === 'codex';
}