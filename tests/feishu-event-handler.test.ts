import { describe, expect, it } from 'vitest';
import { isBotMentioned, parseGroupReplyModeCommand, shouldProcessGroupMessage } from '../src/feishu/event-handler.js';

describe('Feishu event handler mention routing', () => {
  it('only treats an exact mention of the current bot as addressed to it', () => {
    const foreignMentions = [
      { id: { open_id: 'ou_other_bot' }, name: 'Other Bot' },
      { id: { open_id: 'ou_group_member' }, name: 'Group Member' },
    ];

    expect(isBotMentioned(foreignMentions, 'ou_current_bot')).toBe(false);
    expect(
      isBotMentioned(
        [...foreignMentions, { id: { open_id: 'ou_current_bot' }, name: 'Current Bot' }],
        'ou_current_bot',
      ),
    ).toBe(true);
  });

  it('fails closed when the current bot open_id or mention shape is unavailable', () => {
    expect(isBotMentioned([{ id: { open_id: 'ou_other_bot' } }])).toBe(false);
    expect(isBotMentioned(undefined, 'ou_current_bot')).toBe(false);
    expect(isBotMentioned([null, {}, { id: {} }], 'ou_current_bot')).toBe(false);
  });
});

describe('Feishu group reply mode policy', () => {
  it('parses supported English and Chinese commands without matching unrelated commands', () => {
    expect(parseGroupReplyModeCommand('/group-reply all')).toEqual({ action: 'set', mode: 'all' });
    expect(parseGroupReplyModeCommand('/group-reply mention')).toEqual({ action: 'set', mode: 'mention' });
    expect(parseGroupReplyModeCommand('/group_mode @')).toEqual({ action: 'set', mode: 'mention' });
    expect(parseGroupReplyModeCommand('/群回复 全部')).toEqual({ action: 'set', mode: 'all' });
    expect(parseGroupReplyModeCommand('/群回复 仅@')).toEqual({ action: 'set', mode: 'mention' });
    expect(parseGroupReplyModeCommand('/group-reply status')).toEqual({ action: 'status' });
    expect(parseGroupReplyModeCommand('/group-reply invalid')).toEqual({ action: 'help' });
    expect(parseGroupReplyModeCommand('/status')).toBeUndefined();
    expect(parseGroupReplyModeCommand('please /group-reply all')).toBeUndefined();
  });

  it('gives an explicit Agent-and-group mode precedence over global and two-person defaults', () => {
    expect(shouldProcessGroupMessage({ botMentioned: true, storedMode: 'mention' })).toBe(true);
    expect(
      shouldProcessGroupMessage({
        botMentioned: false,
        storedMode: 'mention',
        configGroupNoMention: true,
        privateLikeGroup: true,
      }),
    ).toBe(false);
    expect(shouldProcessGroupMessage({ botMentioned: false, storedMode: 'all' })).toBe(true);
    expect(shouldProcessGroupMessage({ botMentioned: false, configGroupNoMention: true })).toBe(true);
    expect(shouldProcessGroupMessage({ botMentioned: false, privateLikeGroup: true })).toBe(true);
    expect(shouldProcessGroupMessage({ botMentioned: false })).toBe(false);
  });
});
