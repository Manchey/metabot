import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { SessionRegistry } from '../src/session/session-registry.js';
import { ThreadTitleService, normalizeThreadTitle } from '../src/bridge/thread-title.js';
import { CommandHandler } from '../src/bridge/command-handler.js';

const logger = { info: vi.fn(), warn: vi.fn() } as any;
const config = { name: 'test', claude: { defaultWorkingDirectory: '/tmp' } } as any;
let dir: string;
let registry: SessionRegistry;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-title-test-'));
  vi.stubEnv('SESSION_STORE_DIR', dir);
  registry = new SessionRegistry(logger);
});
afterEach(() => { registry.close(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

function seed(chatId: string, prompt: string) {
  return registry.createOrUpdate({ chatId, prompt, botName: 'test', workingDirectory: '/tmp' });
}

describe('persistent thread titles', () => {
  it('generates from the full first question once, without duplicating transcript entries', async () => {
    const generate = vi.fn().mockResolvedValue('修复线程回复');
    const titles = new ThreadTitleService(registry, config, logger, generate);
    const question = '请帮忙分析并修复线程回复的问题。'.repeat(10);
    titles.start('thread1', question, '/tmp', 'codex');
    expect(await titles.get('thread1')).toBe('修复线程回复');
    seed('thread1', question);
    titles.start('thread1', '继续', '/tmp', 'codex');
    expect(await titles.get('thread1')).toBe('修复线程回复');
    expect(generate).toHaveBeenCalledExactlyOnceWith(question, 'codex', undefined);
    expect(registry.getMessages(registry.findByChatId('thread1')!.id)).toHaveLength(1);
    registry.close(); registry = new SessionRegistry(logger);
    const restarted = new ThreadTitleService(registry, config, logger, generate);
    restarted.start('thread1', '新追问', '/tmp', 'codex');
    expect(await restarted.get('thread1')).toBe('修复线程回复');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('preserves manual renames while generation is in flight and isolates threads', async () => {
    let resolve!: (title: string) => void;
    const generate = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const titles = new ThreadTitleService(registry, config, logger, generate);
    titles.start('a', '第一个话题', '/tmp', 'codex');
    await Promise.resolve();
    registry.renameSession(registry.findByChatId('a')!.id, '自定义标题');
    seed('b', '另一个话题');
    resolve('自动标题');
    expect(await titles.get('a')).toBe('自定义标题');
    expect(registry.findByChatId('b')!.title).toBe('另一个话题');
  });

  it('falls back on generation failure, retries using the original question, and deduplicates calls', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue('服务诊断');
    const titles = new ThreadTitleService(registry, config, logger, generate);
    titles.start('a', '检查服务的状态', '/tmp', 'codex');
    titles.start('a', '继续', '/tmp', 'codex');
    expect(await titles.get('a')).toBe('检查服务的状态');
    titles.start('a', '现在怎么样了', '/tmp', 'codex');
    expect(await titles.get('a')).toBe('服务诊断');
    expect(generate.mock.calls.map(c => c[0])).toEqual(['检查服务的状态', '检查服务的状态']);
  });

  it('backfills legacy topics from the first saved question and preserves old manual names', async () => {
    const id = seed('legacy', '请帮忙部署最新完整版本');
    const manualId = seed('manual', '原始提问');
    const db = new Database(path.join(dir, 'sessions.db'));
    db.prepare("UPDATE sessions SET title_source = 'legacy', title_prompt = ''").run();
    db.prepare("UPDATE sessions SET title = '手动标题' WHERE id = ?").run(manualId);
    db.close();
    const generate = vi.fn().mockResolvedValue('部署最新版本');
    const titles = new ThreadTitleService(registry, config, logger, generate);
    titles.start('legacy', '继续', '/tmp', 'codex');
    titles.start('manual', '继续', '/tmp', 'codex');
    expect(await titles.get('legacy')).toBe('部署最新版本');
    expect(await titles.get('manual')).toBe('手动标题');
    expect(generate).toHaveBeenCalledExactlyOnceWith('请帮忙部署最新完整版本', 'codex', undefined);
    expect(registry.getSession(id)!.titlePrompt).toBe('请帮忙部署最新完整版本');
  });

  it('migrates the previous database schema without losing messages or titles', () => {
    const id = seed('old-db', '之前保存的首条提问');
    registry.close();
    const db = new Database(path.join(dir, 'sessions.db'));
    db.exec('ALTER TABLE sessions DROP COLUMN title_source; ALTER TABLE sessions DROP COLUMN title_prompt;');
    db.close();
    registry = new SessionRegistry(logger);
    const session = registry.prepareTitle(id);
    expect(session.titleSource).toBe('fallback');
    expect(session.titlePrompt).toBe('之前保存的首条提问');
    expect(registry.getMessages(id)).toHaveLength(1);
  });

  it('normalizes multiline titles, delimiters and Unicode length', () => {
    expect(normalizeThreadTitle('【部署】\n 最新版本')).toBe('部署 最新版本');
    expect(Array.from(normalizeThreadTitle('😀'.repeat(30)))).toHaveLength(24);
  });
});

function handler() {
  const sender = { sendText: vi.fn().mockResolvedValue(undefined) } as any;
  const commands = new CommandHandler(config, logger, sender,
    { getSession: () => ({ workingDirectory: '/tmp' }) } as any,
    {} as any, { log: vi.fn() } as any, () => undefined, () => {}, () => 0,
    async () => {}, () => [], async () => {});
  commands.setSessionRegistry(registry);
  return { commands, sender };
}

it('/title views, renames and persists the current thread, even before its first task', async () => {
  const { commands, sender } = handler();
  const msg = { chatId: 'a', userId: 'u', text: '/title' } as any;
  expect(await commands.handle(msg)).toBe(true);
  expect(sender.sendText).toHaveBeenLastCalledWith('a', expect.stringContaining('/title 新标题'));
  await commands.handle({ ...msg, text: '/title 自己的主题' });
  expect(registry.findByChatId('a')!.titleSource).toBe('manual');
  const generate = vi.fn();
  const titles = new ThreadTitleService(registry, config, logger, generate);
  titles.start('a', '首条提问', '/tmp', 'codex');
  expect(await titles.get('a')).toBe('自己的主题');
  expect(generate).not.toHaveBeenCalled();
  expect(registry.findByChatId('b')).toBeNull();
  await commands.handle(msg);
  expect(sender.sendText).toHaveBeenLastCalledWith('a', expect.stringContaining('【自己的主题】'));
});
