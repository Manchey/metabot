import { describe, expect, it, vi } from 'vitest';
import { listKimiSessions } from '../src/engines/kimi/session-lister.js';
import type { KimiWireSession } from '../src/engines/kimi/daemon-client.js';

function session(id: string, updatedAt: string, prompt: string): KimiWireSession {
  return {
    id,
    title: id,
    created_at: updatedAt,
    updated_at: updatedAt,
    busy: false,
    metadata: { cwd: '/repo' },
    agent_config: { model: 'kimi-code/k3' },
    last_prompt: prompt,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: 0,
      context_tokens: 0,
      context_limit: 1_048_576,
      turn_count: 0,
    },
  };
}

describe('listKimiSessions', () => {
  it('lists current Kimi Code Server sessions newest-first for /resume', async () => {
    const client = {
      listSessions: vi.fn(async () => [
        session('session-old', '2026-07-18T00:00:00.000Z', 'old prompt'),
        session('session-new', '2026-07-19T00:00:00.000Z', 'new\nfrontend prompt'),
      ]),
    };
    const result = await listKimiSessions({
      workingDirectory: '/repo',
      currentSessionId: 'session-new',
      client,
    });

    expect(client.listSessions).toHaveBeenCalledWith('/repo');
    expect(result).toEqual([
      expect.objectContaining({ sessionId: 'session-new', preview: 'new frontend prompt', isCurrent: true }),
      expect.objectContaining({ sessionId: 'session-old', preview: 'old prompt', isCurrent: false }),
    ]);
  });

  it('degrades to an empty picker if the local Kimi server is unavailable', async () => {
    const client = { listSessions: vi.fn(async () => Promise.reject(new Error('offline'))) };
    await expect(listKimiSessions({ workingDirectory: '/repo', client })).resolves.toEqual([]);
  });
});
