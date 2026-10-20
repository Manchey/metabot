import type { BotConfigBase } from '../config.js';
import type { CardState } from '../types.js';
import type { Logger } from '../utils/logger.js';
import type { IMessageSender } from './message-sender.interface.js';
import { normalizeThreadTitle } from './thread-title.js';
import { isVoiceReplyEnabled } from './voice-reply.js';

export const COMPLETION_NOTICE_MIN_DURATION_MS = 10_000;

/**
 * Sends the small push-only completion notice for long-running tasks.
 * Rich details stay in the card footer; this path is only for notification surfaces.
 */
export async function sendCompletionNotice(opts: {
  sender: IMessageSender;
  config: BotConfigBase;
  logger: Logger;
  chatId: string;
  state: CardState;
  durationMs: number;
  title?: string;
  getTitle?: () => Promise<string>;
}): Promise<void> {
  const { sender, config, logger, chatId, state, durationMs } = opts;

  if (sender.skipCompletionNotice) return;
  if (state.status === 'complete' && isVoiceReplyEnabled(config)) return;
  if (durationMs < COMPLETION_NOTICE_MIN_DURATION_MS) return;

  const statusEmoji = state.status === 'complete' ? '✅' : '❌';
  let resolvedTitle = opts.title;
  try { resolvedTitle = await opts.getTitle?.() || resolvedTitle; }
  catch (err) { logger.warn({ err, chatId }, 'Failed to resolve notification title'); }
  const title = normalizeThreadTitle(resolvedTitle || state.userPrompt || '未命名会话');
  const duration = durationMs >= 60_000 ? `${(durationMs / 60_000).toFixed(1)}min` : `${(durationMs / 1000).toFixed(1)}s`;
  const parts = [duration];
  if (state.model) parts.push(state.model.replace(/[\r\n]+/g, ' '));
  if (state.totalTokens != null && state.contextWindow && state.contextWindow > 0) {
    const pct = Math.round(state.totalTokens / state.contextWindow * 100);
    const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const capacity = state.contextWindow >= 1000 ? `${Math.round(state.contextWindow / 1000)}k` : String(state.contextWindow);
    const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
    const color = pct >= 80 ? '🟥' : pct >= 50 ? '🟧' : '🟩';
    parts.push(`${formatTokens(state.totalTokens)}/${capacity} (${pct}%) ${color.repeat(filled)}${'⬜'.repeat(10 - filled)}`);
  }

  try {
    await sender.sendText(chatId, `${statusEmoji}【${title}】${parts.join(' · ')}`);
  } catch (err) {
    logger.warn({ err, chatId }, 'Failed to send completion notice');
  }
}
