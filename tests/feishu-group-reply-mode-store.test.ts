import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGroupReplyModeCommand } from '../src/feishu/event-handler.js';
import { FeishuGroupReplyModeStore } from '../src/feishu/group-reply-mode-store.js';
import { createLogger } from '../src/utils/logger.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createStore(): { store: FeishuGroupReplyModeStore; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metabot-feishu-group-mode-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'modes.db');
  return { store: new FeishuGroupReplyModeStore(createLogger('silent'), dbPath), dbPath };
}

describe('FeishuGroupReplyModeStore', () => {
  it('isolates reply modes by Agent and group', () => {
    const { store } = createStore();
    store.set('agent-a', 'chat-1', 'all', 'owner-1');
    store.set('agent-a', 'chat-2', 'mention', 'owner-2');
    store.set('agent-b', 'chat-1', 'mention', 'owner-1');

    expect(store.get('agent-a', 'chat-1')).toBe('all');
    expect(store.get('agent-a', 'chat-2')).toBe('mention');
    expect(store.get('agent-b', 'chat-1')).toBe('mention');
    expect(store.get('agent-b', 'chat-2')).toBeUndefined();
    store.close();
  });

  it('persists values across store restarts', () => {
    const { store, dbPath } = createStore();
    store.set('agent-a', 'chat-1', 'all', 'owner-1');
    store.close();

    const reopened = new FeishuGroupReplyModeStore(createLogger('silent'), dbPath);
    expect(reopened.get('agent-a', 'chat-1')).toBe('all');
    reopened.close();
  });

  it('consumes valid commands instead of passing them to the Agent pipeline', async () => {
    const { store } = createStore();
    const sendNotice = vi.fn(async () => {});

    await expect(
      handleGroupReplyModeCommand({
        text: '/group-reply all',
        botName: 'agent-a',
        chatId: 'chat-1',
        userId: 'owner-1',
        defaultMode: 'mention',
        canChangeMode: true,
        store,
        sendNotice,
      }),
    ).resolves.toBe(true);
    expect(store.get('agent-a', 'chat-1')).toBe('all');
    expect(sendNotice).toHaveBeenCalledWith(
      'chat-1',
      '群回复模式已更新',
      expect.stringContaining('回复群里的所有消息'),
      'green',
    );

    await expect(
      handleGroupReplyModeCommand({
        text: 'ordinary message',
        botName: 'agent-a',
        chatId: 'chat-1',
        userId: 'owner-1',
        defaultMode: 'mention',
        canChangeMode: true,
        store,
        sendNotice,
      }),
    ).resolves.toBe(false);
    store.close();
  });

  it('fails closed for a non-owner mode change without modifying persistent state', async () => {
    const { store } = createStore();
    const sendNotice = vi.fn(async () => {});

    await expect(
      handleGroupReplyModeCommand({
        text: '/group-reply all',
        botName: 'agent-a',
        chatId: 'chat-1',
        userId: 'member-1',
        defaultMode: 'mention',
        canChangeMode: false,
        store,
        sendNotice,
      }),
    ).resolves.toBe(true);
    expect(store.get('agent-a', 'chat-1')).toBeUndefined();
    expect(sendNotice).toHaveBeenCalledWith('chat-1', '无权限切换群回复模式', expect.any(String), 'red');
    store.close();
  });
});
