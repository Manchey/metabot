/**
 * Shared utilities for Feishu card builders (v1 and v2).
 *
 * Both card-builder.ts (schema v1) and card-builder-v2.ts (schema v2) use
 * the same status config, background-task icons, content length limit, and
 * truncation helpers.  This file is the single source of truth; import from
 * here — do NOT copy these into individual builder files.
 */
import type { CardStatus } from '../types.js';

// ---------------------------------------------------------------------------
// Status display config
// ---------------------------------------------------------------------------

export const STATUS_CONFIG: Record<CardStatus, { color: string; title: string; icon: string }> = {
  thinking:          { color: 'blue',   title: 'Thinking...',       icon: '🔵' },
  running:           { color: 'blue',   title: 'Running...',        icon: '🔵' },
  complete:          { color: 'green',  title: 'Complete',          icon: '🟢' },
  error:             { color: 'red',    title: 'Error',             icon: '🔴' },
  waiting_for_input: { color: 'yellow', title: 'Waiting for Input', icon: '🟡' },
  // Blue with a distinct title so users can tell a between-turn burst card
  // apart from both a live "running" turn and a finished "complete" reply
  // without reading body text.  See message-bridge.flushSpontaneous.
  agent_activity:    { color: 'blue',   title: 'Agent activity',    icon: '🔵' },
};

// ---------------------------------------------------------------------------
// Background-task status icons
// ---------------------------------------------------------------------------

export const BG_ICON: Record<'running' | 'completed' | 'failed' | 'stopped', string> = {
  running:   '⏳',
  completed: '✅',
  failed:    '❌',
  stopped:   '⏹️',
};

// ---------------------------------------------------------------------------
// Content truncation
// ---------------------------------------------------------------------------

/** Hard character limit for response text sent to Feishu. */
export const MAX_CONTENT_LENGTH = 28000;

/**
 * Truncate `text` to `max` characters, appending an ellipsis if shortened.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

/**
 * Truncate response body to `MAX_CONTENT_LENGTH`, keeping the head and tail
 * so that both the opening and closing context are visible to the user.
 */
export function truncateContent(text: string): string {
  if (text.length <= MAX_CONTENT_LENGTH) return text;
  const half = Math.floor(MAX_CONTENT_LENGTH / 2) - 50;
  return text.slice(0, half) + '\n\n... (content truncated) ...\n\n' + text.slice(-half);
}
