import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotConfigBase } from '../src/config.js';
import type { CardState } from '../src/types.js';
import type { IMessageSender } from '../src/bridge/message-sender.interface.js';
import { sendCompletionNotice } from '../src/bridge/notification-policy.js';

function makeConfig(overrides: Partial<BotConfigBase> = {}): BotConfigBase {
  return {
    name: 'test',
    claude: {
      defaultWorkingDirectory: '/tmp',
      maxTurns: undefined,
      maxBudgetUsd: undefined,
      model: undefined,
      apiKey: undefined,
      outputsBaseDir: '/tmp/outputs',
      downloadsDir: '/tmp/downloads',
      backend: 'pty',
    },
    ...overrides,
  };
}

function makeState(status: CardState['status']): CardState {
  return {
    status,
    userPrompt: 'prompt',
    responseText: 'response',
    toolCalls: [],
  };
}

function makeSender(overrides: Partial<IMessageSender> = {}): IMessageSender {
  return {
    sendCard: vi.fn(),
    updateCard: vi.fn(),
    sendTextNotice: vi.fn(),
    sendText: vi.fn(),
    sendImageFile: vi.fn(),
    sendLocalFile: vi.fn(),
    downloadImage: vi.fn(),
    downloadFile: vi.fn(),
    ...overrides,
  };
}

describe('sendCompletionNotice', () => {
  afterEach(() => {
    delete process.env.METABOT_VOICE_REPLY;
    delete process.env.FEISHU_VOICE_REPLY;
    delete process.env.METABOT_VOICE_REPLY_DEFAULT_ON;
    vi.restoreAllMocks();
  });

  it('skips short tasks', async () => {
    const sender = makeSender();
    await sendCompletionNotice({
      sender,
      config: makeConfig(),
      logger: { warn: vi.fn() } as any,
      chatId: 'chat',
      state: makeState('complete'),
      durationMs: 9_999,
    });

    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it('skips senders that already route final responses separately', async () => {
    const sender = makeSender({ skipCompletionNotice: true });
    await sendCompletionNotice({
      sender,
      config: makeConfig(),
      logger: { warn: vi.fn() } as any,
      chatId: 'chat',
      state: makeState('complete'),
      durationMs: 10_000,
    });

    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it('skips successful tasks when voice reply is enabled', async () => {
    const sender = makeSender();
    await sendCompletionNotice({
      sender,
      config: makeConfig({ voiceReply: { enabled: true } }),
      logger: { warn: vi.fn() } as any,
      chatId: 'chat',
      state: makeState('complete'),
      durationMs: 10_000,
    });

    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it('sends a titled notice for long successful tasks without voice reply', async () => {
    const sender = makeSender();
    await sendCompletionNotice({
      sender,
      config: makeConfig(),
      logger: { warn: vi.fn() } as any,
      chatId: 'chat',
      state: makeState('complete'),
      durationMs: 10_000,
    });

    expect(sender.sendText).toHaveBeenCalledWith('chat', '✅【prompt】10.0s');
  });

  it('sends Failed for long failed tasks', async () => {
    const sender = makeSender();
    await sendCompletionNotice({
      sender,
      config: makeConfig({ voiceReply: { enabled: true } }),
      logger: { warn: vi.fn() } as any,
      chatId: 'chat',
      state: makeState('error'),
      durationMs: 10_000,
    });

    expect(sender.sendText).toHaveBeenCalledWith('chat', '❌【prompt】10.0s');
  });

  it('matches the single-line format without costs', async () => {
    const sender = makeSender();
    await sendCompletionNotice({ sender, config: makeConfig(), logger: { warn: vi.fn() } as any,
      chatId: 'chat', title: '部署最新完整版本', durationMs: 540_000,
      state: { ...makeState('complete'), model: 'qwen3.8-flash', costUsd: 6.76, sessionCostUsd: 19,
        totalTokens: 156_000, contextWindow: 200_000 },
    });
    expect(sender.sendText).toHaveBeenCalledWith('chat',
      '✅【部署最新完整版本】9.0min · qwen3.8-flash · 156.0k/200k (78%) 🟧🟧🟧🟧🟧🟧🟧🟧⬜⬜');
  });

  it('clamps overflowing context bars and falls back if title lookup fails', async () => {
    const sender = makeSender();
    await sendCompletionNotice({ sender, config: makeConfig(), logger: { warn: vi.fn() } as any,
      chatId: 'chat', durationMs: 60_000, getTitle: async () => { throw new Error('lookup failed'); },
      state: { ...makeState('error'), userPrompt: '【服务】\n诊断', totalTokens: 250_000, contextWindow: 200_000 },
    });
    expect(sender.sendText).toHaveBeenCalledWith('chat',
      '❌【服务 诊断】1.0min · 250.0k/200k (125%) 🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥');
  });

  it('does not resolve a title for a skipped notification', async () => {
    const getTitle = vi.fn();
    await sendCompletionNotice({ sender: makeSender(), config: makeConfig(), logger: {} as any,
      chatId: 'chat', state: makeState('complete'), durationMs: 500, getTitle });
    expect(getTitle).not.toHaveBeenCalled();
  });

  it('logs and swallows send failures', async () => {
    const logger = { warn: vi.fn() };
    const sender = makeSender({ sendText: vi.fn().mockRejectedValue(new Error('nope')) });
    await sendCompletionNotice({
      sender,
      config: makeConfig(),
      logger: logger as any,
      chatId: 'chat',
      state: makeState('complete'),
      durationMs: 10_000,
    });

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat' }), 'Failed to send completion notice');
  });
});
