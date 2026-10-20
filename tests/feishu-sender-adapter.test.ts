import { describe, it, expect, vi } from 'vitest';
import { FeishuSenderAdapter } from '../src/feishu/feishu-sender-adapter.js';
import type { CardState } from '../src/types.js';

// Question cards use schema 2.0 native button behaviors, with typed answers available.
describe('FeishuSenderAdapter.sendQuestionCard / updateQuestionCard', () => {
  function makeAdapter() {
    const sendCard = vi.fn().mockResolvedValue('msg_123');
    const updateCard = vi.fn().mockResolvedValue(true);
    const fakeSender = {
      sendCard,
      updateCard,
      sendText: vi.fn(),
      sendImageFile: vi.fn(),
      sendLocalFile: vi.fn(),
      sendAudioFile: vi.fn(),
      downloadImage: vi.fn(),
      downloadFile: vi.fn(),
    } as any;
    return { adapter: new FeishuSenderAdapter(fakeSender), sendCard, updateCard, fakeSender };
  }

  const questionState: CardState = {
    status: 'waiting_for_input',
    userPrompt: 'Question',
    responseText: '',
    toolCalls: [],
    pendingQuestion: {
      toolUseId: 'toolu_test',
      questions: [{
        question: '今晚吃什么？',
        header: '今晚晚餐',
        options: [
          { label: '吃鸡', description: '炸鸡' },
          { label: '吃鸭', description: '烤鸭' },
        ],
        multiSelect: false,
      }],
    },
  };

  it('sendQuestionCard builds a v2 card (schema:"2.0")', async () => {
    const { adapter, sendCard } = makeAdapter();
    await adapter.sendQuestionCard('oc_test', questionState);
    expect(sendCard).toHaveBeenCalledOnce();
    const cardJson = sendCard.mock.calls[0][1] as string;
    expect(cardJson).toContain('"schema":"2.0"');
    expect(cardJson).toContain('吃鸡');
    expect(cardJson).toContain('吃鸭');
  });

  it('question cards render native buttons with callbacks and a typed-answer fallback', () => {
    const { adapter, sendCard } = makeAdapter();
    void adapter.sendQuestionCard('oc_test', questionState);
    const cardJson = sendCard.mock.calls[0][1] as string;
    expect(cardJson).not.toContain('"tag":"action"');
    expect(cardJson).toContain('answer_question');
    // Numbered options + typed-reply prompt must still be present so users
    // know HOW to answer without buttons.
    expect(cardJson).toContain('**1.** 吃鸡');
    expect(cardJson).toContain('**2.** 吃鸭');
    expect(cardJson).toContain('请回复数字');
  });

  it('updateQuestionCard builds a v2 card', async () => {
    const { adapter, updateCard } = makeAdapter();
    await adapter.updateQuestionCard('msg_test', questionState);
    expect(updateCard).toHaveBeenCalledOnce();
    const cardJson = updateCard.mock.calls[0][1] as string;
    expect(cardJson).toContain('"schema":"2.0"');
  });

  it('regular sendCard still uses v2 default (sanity)', async () => {
    const { adapter, sendCard } = makeAdapter();
    await adapter.sendCard('oc_test', {
      status: 'running',
      userPrompt: 'a thing',
      responseText: 'working',
      toolCalls: [],
    });
    const cardJson = sendCard.mock.calls[0][1] as string;
    expect(cardJson).toContain('"schema":"2.0"');
  });

  it('sendQuestionCard returns the underlying messageId from sender.sendCard', async () => {
    const { adapter, sendCard } = makeAdapter();
    sendCard.mockResolvedValueOnce('msg_specific');
    const id = await adapter.sendQuestionCard('oc_test', questionState);
    expect(id).toBe('msg_specific');
  });

  it('sendAudioFile forwards native audio sends to the Feishu sender', async () => {
    const { adapter, fakeSender } = makeAdapter();
    fakeSender.sendAudioFile.mockResolvedValueOnce(true);
    await expect(adapter.sendAudioFile('oc_test', '/tmp/reply.opus')).resolves.toBe(true);
    expect(fakeSender.sendAudioFile).toHaveBeenCalledWith('oc_test', '/tmp/reply.opus', 'reply.opus');
  });
});
