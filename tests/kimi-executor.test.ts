import { describe, expect, it, vi } from 'vitest';
import type { BotConfigBase } from '../src/config.js';
import { StreamProcessor } from '../src/engines/claude/stream-processor.js';
import { KimiExecutor, type KimiClientLike } from '../src/engines/kimi/executor.js';
import type { KimiPendingQuestion, KimiSessionSnapshot, KimiSessionStatus } from '../src/engines/kimi/daemon-client.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => logger,
} as any;

function config(): BotConfigBase {
  return {
    name: 'kimi-test',
    engine: 'kimi',
    kimi: { model: 'k3', contextWindow: 1_048_576, thinking: true },
    claude: {
      defaultWorkingDirectory: '/tmp',
      maxTurns: undefined,
      maxBudgetUsd: undefined,
      model: undefined,
      apiKey: undefined,
      outputsBaseDir: '/tmp',
      downloadsDir: '/tmp',
      backend: 'pty',
    },
  };
}

function snapshot(overrides: Partial<KimiSessionSnapshot> = {}): KimiSessionSnapshot {
  return {
    as_of_seq: 1,
    epoch: 'ep-test',
    session: {
      id: 'session-kimi-1',
      title: 'test',
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:01.000Z',
      busy: false,
      last_turn_reason: 'completed',
      metadata: { cwd: '/tmp' },
      agent_config: { model: 'kimi-code/k3' },
      usage: {
        input_tokens: 120,
        output_tokens: 12,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_cost_usd: 0,
        context_tokens: 132,
        context_limit: 1_048_576,
        turn_count: 1,
      },
    },
    messages: { items: [], has_more: false },
    in_flight_turn: null,
    subagents: [],
    pending_approvals: [],
    pending_questions: [],
    ...overrides,
  };
}

class FakeKimiClient implements KimiClientLike {
  submitted = false;
  answered = false;
  afterSubmit: () => Promise<KimiSessionSnapshot> = async () => snapshot();
  steer = vi.fn(async () => undefined);
  abortSession = vi.fn(async () => undefined);
  setGoal = vi.fn(async () => undefined);
  controlGoal = vi.fn(async () => undefined);
  approve = vi.fn(async () => undefined);
  respondQuestion = vi.fn(async () => {
    this.answered = true;
  });
  submitPrompt = vi.fn(async () => {
    this.submitted = true;
    return { prompt_id: 'prompt-1', status: 'running' as const };
  });

  async resolveModel(): Promise<{ id: string; displayName: string }> {
    return { id: 'kimi-code/k3', displayName: 'Kimi K3' };
  }

  async openSession(): Promise<{ id: string }> {
    return { id: 'session-kimi-1' };
  }

  async getSnapshot(): Promise<KimiSessionSnapshot> {
    return this.submitted ? this.afterSubmit() : snapshot();
  }

  async getStatus(): Promise<KimiSessionStatus> {
    return {
      busy: false,
      model: 'Kimi K3',
      thinking_level: 'high',
      permission: 'yolo',
      context_tokens: 132,
      max_context_tokens: 1_048_576,
      context_usage: 132 / 1_048_576,
    };
  }

  async getGoal(): Promise<Record<string, unknown> | null> {
    return null;
  }
}

async function collect(stream: AsyncGenerator<any>): Promise<any[]> {
  const messages: any[] = [];
  for await (const message of stream) messages.push(message);
  return messages;
}

describe('KimiExecutor Feishu parity', () => {
  it('renders Kimi Code Server tools, usage, text, and subagent activity', async () => {
    const client = new FakeKimiClient();
    client.afterSubmit = async () =>
      snapshot({
        messages: {
          has_more: false,
          items: [
            {
              id: 'assistant-tool',
              session_id: 'session-kimi-1',
              role: 'assistant',
              prompt_id: 'prompt-1',
              created_at: '2026-07-19T00:00:02.000Z',
              content: [
                {
                  type: 'tool_use',
                  tool_call_id: 'tool-1',
                  tool_name: 'ReadFile',
                  input: { path: '/repo/src/App.tsx' },
                },
              ],
            },
            {
              id: 'tool-result',
              session_id: 'session-kimi-1',
              role: 'tool',
              prompt_id: 'prompt-1',
              created_at: '2026-07-19T00:00:03.000Z',
              content: [{ type: 'tool_result', tool_call_id: 'tool-1', output: 'file contents' }],
            },
            {
              id: 'assistant-text',
              session_id: 'session-kimi-1',
              role: 'assistant',
              prompt_id: 'prompt-1',
              created_at: '2026-07-19T00:00:04.000Z',
              content: [{ type: 'text', text: 'done' }],
            },
          ],
        },
        subagents: [
          {
            id: 'subagent-1',
            session_id: 'session-kimi-1',
            description: 'Implement responsive frontend',
            status: 'completed',
            subagent_phase: 'completed',
            output_preview: 'mobile layout complete',
          },
        ],
      });

    const executor = new KimiExecutor(config(), logger, client);
    const handle = executor.startExecution({
      prompt: 'inspect app',
      cwd: '/tmp',
      abortController: new AbortController(),
      apiContext: { botName: 'kimi-test', chatId: 'oc-kimi-tools' },
    });
    const processor = new StreamProcessor('inspect app');
    let final: any;
    for (const message of await collect(handle.stream)) final = processor.processMessage(message);

    expect(final).toMatchObject({
      status: 'complete',
      responseText: 'done',
      model: 'Kimi K3',
      totalTokens: 120,
      contextWindow: 1_048_576,
      toolCalls: [{ name: 'Read', detail: '`.../src/App.tsx`', status: 'done' }],
      backgroundEvents: [
        expect.objectContaining({
          taskId: 'subagent-1',
          description: 'Implement responsive frontend',
          status: 'completed',
        }),
      ],
    });
  });

  it('surfaces a Kimi question and routes the Feishu answer to the daemon', async () => {
    const client = new FakeKimiClient();
    const question: KimiPendingQuestion = {
      question_id: 'question-1',
      session_id: 'session-kimi-1',
      tool_call_id: 'tool-question-1',
      questions: [
        {
          id: 'q1',
          question: 'Continue deployment?',
          header: 'Confirm',
          options: [{ id: 'continue', label: 'Continue', description: 'Proceed now' }],
        },
      ],
    };
    client.afterSubmit = async () =>
      client.answered
        ? snapshot({
            messages: {
              has_more: false,
              items: [
                {
                  id: 'answer',
                  session_id: 'session-kimi-1',
                  role: 'assistant',
                  created_at: '2026-07-19T00:00:04.000Z',
                  content: [{ type: 'text', text: 'deployment continued' }],
                },
              ],
            },
          })
        : snapshot({
            session: { ...snapshot().session, busy: true, pending_interaction: 'question' },
            pending_questions: [question],
          });

    const executor = new KimiExecutor(config(), logger, client);
    const handle = executor.startExecution({
      prompt: 'deploy',
      cwd: '/tmp',
      abortController: new AbortController(),
      apiContext: { botName: 'kimi-test', chatId: 'oc-kimi-question' },
    });

    await expect(handle.stream.next()).resolves.toMatchObject({ value: { type: 'system' } });
    const request = await handle.stream.next();
    expect(request.value).toMatchObject({
      type: 'assistant',
      message: {
        content: [
          {
            id: 'tool-question-1',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Continue deployment?' }] },
          },
        ],
      },
    });

    handle.resolveQuestion('tool-question-1', { 'Continue deployment?': 'Continue' });
    await vi.waitFor(() =>
      expect(client.respondQuestion).toHaveBeenCalledWith('session-kimi-1', question, {
        'Continue deployment?': 'Continue',
      }),
    );
    const remaining = await collect(handle.stream);
    expect(remaining.at(-1)).toMatchObject({ type: 'result', subtype: 'success', result: 'deployment continued' });
  });

  it('uses the native Kimi prompt queue steering path during an active turn', async () => {
    const client = new FakeKimiClient();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.afterSubmit = async () => {
      await gate;
      return snapshot({
        messages: {
          has_more: false,
          items: [
            {
              id: 'steered-answer',
              session_id: 'session-kimi-1',
              role: 'assistant',
              created_at: '2026-07-19T00:00:03.000Z',
              content: [{ type: 'text', text: 'mobile layout complete' }],
            },
          ],
        },
      });
    };

    const executor = new KimiExecutor(config(), logger, client);
    const handle = executor.startExecution({
      prompt: 'build frontend',
      cwd: '/tmp',
      abortController: new AbortController(),
      apiContext: { botName: 'kimi-test', chatId: 'oc-kimi-steer' },
    });
    await handle.stream.next();
    const pending = handle.stream.next();
    await vi.waitFor(() => expect(client.submitPrompt).toHaveBeenCalled());

    expect(executor.canSteer('oc-kimi-steer')).toBe(true);
    await expect(executor.steer('oc-kimi-steer', 'also optimize mobile')).resolves.toBe('steered');
    expect(client.steer).toHaveBeenCalledWith('session-kimi-1', 'also optimize mobile', {
      model: 'kimi-code/k3',
      thinking: 'high',
    });
    release();
    await pending;
    await collect(handle.stream);
    expect(executor.canSteer('oc-kimi-steer')).toBe(false);
  });

  it('maps /stop aborts to the active Kimi Code session and closes the turn', async () => {
    const client = new FakeKimiClient();
    let releaseAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      releaseAbort = resolve;
    });
    client.abortSession = vi.fn(async () => {
      releaseAbort();
    });
    client.afterSubmit = async () => {
      await aborted;
      return snapshot({
        session: { ...snapshot().session, last_turn_reason: 'cancelled' },
      });
    };
    const abortController = new AbortController();
    const executor = new KimiExecutor(config(), logger, client);
    const handle = executor.startExecution({
      prompt: 'long frontend task',
      cwd: '/tmp',
      abortController,
      apiContext: { botName: 'kimi-test', chatId: 'oc-kimi-stop' },
    });
    await handle.stream.next();
    const pending = handle.stream.next();
    await vi.waitFor(() => expect(client.submitPrompt).toHaveBeenCalled());

    abortController.abort();
    const terminal = await pending;
    await collect(handle.stream);

    expect(client.abortSession).toHaveBeenCalledWith('session-kimi-1');
    expect(terminal.value).toMatchObject({ type: 'result', subtype: 'error_cancelled', is_error: true });
  });

  it('does not auto-approve a pending tool request in the default permission mode', async () => {
    const client = new FakeKimiClient();
    client.afterSubmit = async () =>
      snapshot({
        session: { ...snapshot().session, busy: true, pending_interaction: 'approval' },
        pending_approvals: [
          {
            approval_id: 'approval-1',
            session_id: 'session-kimi-1',
            tool_call_id: 'tool-1',
            tool_name: 'Shell',
          },
        ],
      });

    const executor = new KimiExecutor(config(), logger, client);
    const messages = await collect(
      executor.startExecution({
        prompt: 'run a sensitive command',
        cwd: '/tmp',
        abortController: new AbortController(),
        apiContext: { botName: 'kimi-test', chatId: 'oc-kimi-approval' },
      }).stream,
    );

    expect(client.approve).not.toHaveBeenCalled();
    expect(client.abortSession).toHaveBeenCalledWith('session-kimi-1');
    expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'error_during_execution', is_error: true });
    expect(messages.at(-1)?.errors?.[0]).toContain('did not auto-approve');
  });

  it('maps /goal to Kimi Code native goal state and submits only the objective', async () => {
    const client = new FakeKimiClient();
    const executor = new KimiExecutor(config(), logger, client);
    await collect(
      executor.startExecution({
        prompt: '/goal ship the frontend',
        cwd: '/tmp',
        abortController: new AbortController(),
        apiContext: { botName: 'kimi-test', chatId: 'oc-kimi-goal' },
      }).stream,
    );

    expect(client.setGoal).toHaveBeenCalledWith('session-kimi-1', 'ship the frontend');
    expect(client.submitPrompt).toHaveBeenCalledWith(
      'session-kimi-1',
      expect.stringContaining('ship the frontend'),
      expect.objectContaining({ model: 'kimi-code/k3', permissionMode: 'auto' }),
    );
    expect(client.submitPrompt.mock.calls[0]?.[1]).not.toContain('/goal');
  });
});
