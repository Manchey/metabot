import { describe, expect, it, vi } from 'vitest';
import { MessageSender } from '../src/feishu/message-sender.js';
import { createLogger } from '../src/utils/logger.js';

describe('MessageSender Feishu group owner verification', () => {
  it('looks up and caches the owner open_id per chat', async () => {
    const get = vi.fn(async ({ path }: { path: { chat_id: string } }) => ({
      data: { owner_id: path.chat_id === 'chat-1' ? 'owner-1' : 'owner-2' },
    }));
    const sender = new MessageSender({ im: { v1: { chat: { get } } } } as never, createLogger('silent'));

    await expect(sender.isChatOwner('chat-1', 'owner-1')).resolves.toBe(true);
    await expect(sender.isChatOwner('chat-1', 'member-1')).resolves.toBe(false);
    await expect(sender.isChatOwner('chat-2', 'owner-2')).resolves.toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, {
      params: { user_id_type: 'open_id' },
      path: { chat_id: 'chat-1' },
    });
  });

  it('fails closed when the owner cannot be resolved', async () => {
    const missingGet = vi.fn(async () => ({ data: {} }));
    const missing = new MessageSender({ im: { v1: { chat: { get: missingGet } } } } as never, createLogger('silent'));
    await expect(missing.isChatOwner('chat-1', 'owner-1')).resolves.toBeUndefined();
    await expect(missing.isChatOwner('chat-1', 'owner-1')).resolves.not.toBe(true);
    expect(missingGet).toHaveBeenCalledTimes(1);

    const failed = new MessageSender(
      { im: { v1: { chat: { get: vi.fn(async () => Promise.reject(new Error('denied'))) } } } } as never,
      createLogger('silent'),
    );
    await expect(failed.isChatOwner('chat-1', 'owner-1')).resolves.toBeUndefined();
  });
});
