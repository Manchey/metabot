/**
 * In-memory store of chatIds that don't require @mention.
 * Keyed by `botName:chatId` so multiple bots don't collide.
 *
 * Toggled via the `/noMention` command. Not persisted across restarts.
 */
const noMentionChatIds = new Set<string>();

export function isNoMentionChat(botName: string, chatId: string): boolean {
  return noMentionChatIds.has(`${botName}:${chatId}`);
}

export function addNoMentionChat(botName: string, chatId: string): void {
  noMentionChatIds.add(`${botName}:${chatId}`);
}

export function removeNoMentionChat(botName: string, chatId: string): void {
  noMentionChatIds.delete(`${botName}:${chatId}`);
}