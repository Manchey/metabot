// Shared types used across IM platforms (Feishu, Telegram, etc.)

export type CardStatus = 'thinking' | 'running' | 'complete' | 'error' | 'waiting_for_input';

export interface ToolCall {
  name: string;
  detail: string;
  status: 'running' | 'done';
}

export interface PendingQuestion {
  toolUseId: string;
  questions: Array<{
    question: string;
    header: string;
    /**
     * Key used in the answers map sent back to the SDK. Defaults to `header`,
     * but StreamProcessor disambiguates it ("Header #2") when two questions in
     * the same call share a header — otherwise one answer would overwrite the
     * other in the bridge's collectedAnswers record.
     */
    key?: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  /**
   * Labels already toggled on for a multi-select question. Display-only: the
   * bridge sets it so the card can mark those buttons ✓ and enable the submit
   * button; StreamProcessor never populates it.
   */
  selected?: string[];
}

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface BackgroundEvent {
  taskId: string;
  description: string;
  status: BackgroundTaskStatus;
  /** Latest stdout event line from the task, if any. */
  lastEvent?: string;
}

export interface CardState {
  status: CardStatus;
  userPrompt: string;
  responseText: string;
  toolCalls: ToolCall[];
  costUsd?: number;
  durationMs?: number;
  errorMessage?: string;
  pendingQuestion?: PendingQuestion;
  /** Primary model used (e.g. "claude-opus-4-7") */
  model?: string;
  /** Total input+output tokens consumed */
  totalTokens?: number;
  /** Context window size of the primary model */
  contextWindow?: number;
  /** Cumulative session cost (USD), accumulated across queries until /reset */
  sessionCostUsd?: number;
  /** Background tasks (e.g. Monitor) the agent has spawned during this turn. */
  backgroundEvents?: BackgroundEvent[];
}

export interface IncomingMessage {
  messageId: string;
  chatId: string;
  chatType: string;
  userId: string;
  text: string;
  imageKey?: string;
  fileKey?: string;
  fileName?: string;
  /** Additional media from batched messages (smart debounce). */
  extraMedia?: Array<{
    messageId: string;
    imageKey?: string;
    fileKey?: string;
    fileName?: string;
  }>;
  /** Thread ID if this message is in a thread (话题回复). Used to continue conversation in the same thread. */
  threadId?: string;
  /** Root message ID - the message that started the thread. Used as session key for thread continuity. */
  rootId?: string;
  /** Parent message ID (the immediate parent in thread hierarchy). */
  parentMessageId?: string;
  /** Reaction ID of the "hourglass/waiting" reaction (added when task was queued). */
  hourglassReactionId?: string;
}
