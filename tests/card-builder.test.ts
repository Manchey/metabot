import { describe, it, expect } from 'vitest';
import { buildCard, buildHelpCard, buildStatusCard, buildTextCard } from '../src/feishu/card-builder.js';
import { buildCardV2 } from '../src/feishu/card-builder-v2.js';
import type { CardState } from '../src/types.js';

describe('buildCard', () => {
  it('builds thinking card', () => {
    const state: CardState = {
      status: 'thinking',
      userPrompt: 'hello',
      responseText: '',
      toolCalls: [],
    };
    const json = JSON.parse(buildCard(state));
    expect(json.header.template).toBe('blue');
    expect(json.header.title.content).toContain('Thinking');
    expect(json.elements.some((e: any) => e.tag === 'markdown' && /thinking/i.test(e.content))).toBe(true);
  });

  it('builds running card with a single-line tool indicator (no per-tool list)', () => {
    const state: CardState = {
      status: 'running',
      userPrompt: 'fix bug',
      responseText: 'Looking at the code...',
      toolCalls: [
        { name: 'Read', detail: '`src/index.ts`', status: 'done' },
        { name: 'Edit', detail: '`src/index.ts`', status: 'running' },
      ],
    };
    const json = JSON.parse(buildCard(state));
    expect(json.header.template).toBe('blue');
    // Should show one summary line referencing the latest (running) tool +
    // the total tool count, NOT a per-tool list. The earlier completed tool
    // ("Read") must NOT appear — only the current "Edit" plus the count.
    const md = json.elements.find(
      (e: any) => e.tag === 'markdown' && /\*\*Edit\*\* · 2 tools/.test(e.content),
    );
    expect(md).toBeDefined();
    expect(md.content).toContain('⏳');
    expect(md.content).not.toContain('Read');
    expect(md.content).not.toContain('✅');
  });

  it('omits the tool indicator entirely once the turn is complete', () => {
    const state: CardState = {
      status: 'complete',
      userPrompt: 'fix bug',
      responseText: 'Done.',
      toolCalls: [
        { name: 'Read', detail: '`src/index.ts`', status: 'done' },
        { name: 'Edit', detail: '`src/index.ts`', status: 'done' },
      ],
    };
    const json = JSON.parse(buildCard(state));
    const toolEl = json.elements.find(
      (e: any) => e.tag === 'markdown' && (e.content.includes('Read') || e.content.includes('Edit') || /\d+ tools?/.test(e.content)),
    );
    expect(toolEl).toBeUndefined();
  });

  it('keeps a tool summary when a complete turn has no response text', () => {
    const state: CardState = {
      status: 'complete',
      userPrompt: 'run the task',
      responseText: '',
      toolCalls: [
        { name: 'Read', detail: '`src/index.ts`', status: 'done' },
        { name: 'Edit', detail: '`src/index.ts`', status: 'done' },
      ],
    };
    const json = JSON.parse(buildCard(state));
    const toolEl = json.elements.find(
      (e: any) => e.tag === 'markdown' && /\*\*Edit\*\* · 2 tools/.test(e.content),
    );
    expect(toolEl).toBeDefined();
    expect(toolEl.content).toContain('✅');
  });

  it('builds complete card with stats', () => {
    const state: CardState = {
      status: 'complete',
      userPrompt: 'task',
      responseText: 'All done!',
      toolCalls: [],
      durationMs: 5000,
      costUsd: 0.03,
    };
    const json = JSON.parse(buildCard(state));
    expect(json.header.template).toBe('green');
    const note = json.elements.find((e: any) => e.tag === 'note');
    expect(note).toBeDefined();
    expect(note.elements[0].content).toContain('5.0s');
  });

  // Cards from flushSpontaneous (between-turn agent activity) are sent with
  // the `agent_activity` status so users can see at a glance that the card
  // isn't a normal user-turn reply. Blue header, distinct title — the body
  // no longer carries the long italic "Agent activity between turns (…)"
  // caption that v1 had.
  it('builds an agent_activity card with a blue header and an "Agent activity" title', () => {
    const state: CardState = {
      status: 'agent_activity',
      userPrompt: '(agent activity)',
      responseText: 'Pushed commit abc1234.',
      toolCalls: [],
    };
    const json = JSON.parse(buildCard(state));
    expect(json.header.template).toBe('blue');
    expect(json.header.title.content).toContain('Agent activity');
    // The body must NOT include the legacy italic caption.
    const captionEl = json.elements.find(
      (e: any) => e.tag === 'markdown' && /Agent activity between turns/.test(e.content),
    );
    expect(captionEl).toBeUndefined();
    // The actual conclusion text must be present.
    const bodyEl = json.elements.find(
      (e: any) => e.tag === 'markdown' && e.content.includes('Pushed commit abc1234'),
    );
    expect(bodyEl).toBeDefined();
  });

  it('builds error card with error message', () => {
    const state: CardState = {
      status: 'error',
      userPrompt: 'task',
      responseText: '',
      toolCalls: [],
      errorMessage: 'Process crashed',
    };
    const json = JSON.parse(buildCard(state));
    expect(json.header.template).toBe('red');
    const errEl = json.elements.find((e: any) => e.tag === 'markdown' && e.content.includes('Process crashed'));
    expect(errEl).toBeDefined();
  });

  it('builds waiting_for_input card with question', () => {
    const state: CardState = {
      status: 'waiting_for_input',
      userPrompt: 'deploy',
      responseText: 'Before deploying...',
      toolCalls: [],
      pendingQuestion: {
        toolUseId: 'q1',
        questions: [{
          question: 'Which env?',
          header: 'Deploy',
          options: [
            { label: 'Production', description: 'Live environment' },
            { label: 'Staging', description: 'Test environment' },
          ],
          multiSelect: false,
        }],
      },
    };
    const json = JSON.parse(buildCard(state));
    expect(json.header.template).toBe('yellow');
    const qEl = json.elements.find((e: any) => e.tag === 'markdown' && e.content.includes('Which env?'));
    expect(qEl).toBeDefined();
    expect(qEl.content).toContain('Production');
    expect(qEl.content).toContain('Staging');
    // update_multi stays true even though we don't ship action buttons —
    // belt-and-braces in case Feishu ever decides to redeliver clicks.
    expect(json.config.update_multi).toBe(true);
    // Buttons were removed: v2 mobile silently drops `tag: action` blocks,
    // and v1 buttons trigger code 200340 on click. Question cards default
    // to typed answers — numbered options inline + a prompt to reply.
    const actionEl = json.elements.find((e: any) => e.tag === 'action');
    expect(actionEl).toBeUndefined();
    const promptEl = json.elements.find(
      (e: any) => e.tag === 'markdown' && typeof e.content === 'string' && e.content.includes('请回复数字'),
    );
    expect(promptEl).toBeDefined();
  });

  it('truncates long content', () => {
    const state: CardState = {
      status: 'complete',
      userPrompt: 'task',
      responseText: 'x'.repeat(30000),
      toolCalls: [],
    };
    const json = JSON.parse(buildCard(state));
    const md = json.elements.find((e: any) => e.tag === 'markdown' && e.content.includes('truncated'));
    expect(md).toBeDefined();
  });

  it('renders a background task section with status icon + last event', () => {
    const state: CardState = {
      status: 'running',
      userPrompt: 'watch ci',
      responseText: 'watching…',
      toolCalls: [],
      backgroundEvents: [
        { taskId: 'bheol4172', description: 'Watching CI for PR #215', status: 'running', lastEvent: 'check (20) running' },
        { taskId: 'bmkr16j6f', description: 'Watching deploy', status: 'completed', lastEvent: 'CI done: success' },
      ],
    };
    const json = JSON.parse(buildCard(state));
    const bg = json.elements.find((e: any) => e.tag === 'markdown' && /Background/.test(e.content));
    expect(bg).toBeDefined();
    expect(bg.content).toContain('⏳');
    expect(bg.content).toContain('✅');
    expect(bg.content).toContain('Watching CI for PR #215');
    expect(bg.content).toContain('check (20) running');
    expect(bg.content).toContain('CI done: success');
    expect(bg.content).toContain('bheol4'); // short task id
  });

  it('omits background section when no events', () => {
    const state: CardState = {
      status: 'running',
      userPrompt: 'x',
      responseText: 'y',
      toolCalls: [],
    };
    const json = JSON.parse(buildCard(state));
    const bg = json.elements.find((e: any) => e.tag === 'markdown' && /Background/.test(e.content));
    expect(bg).toBeUndefined();
  });

  // Regression — keep parity with card-builder-v2: both builders must render
  // these or /goal and Agent Teams become invisible to users.
  it('renders 🎯 Goal badge when goalCondition is set (regression)', () => {
    const state: CardState = {
      status:        'running',
      userPrompt:    't',
      responseText:  '',
      toolCalls:     [],
      goalCondition: 'Ship the PR by Friday',
    };
    const json = JSON.parse(buildCard(state));
    const goal = json.elements.find(
      (e: any) => e.tag === 'markdown' && typeof e.content === 'string' && e.content.includes('🎯'),
    );
    expect(goal).toBeDefined();
    expect(goal.content).toContain('Ship the PR by Friday');
  });

  it('renders 🧑‍🤝‍🧑 Team panel when teamState has members or tasks (regression)', () => {
    const state: CardState = {
      status:       'running',
      userPrompt:   't',
      responseText: '',
      toolCalls:    [],
      teamState: {
        name:      'feishu-ux-review',
        teammates: [{ name: 'ux-researcher', status: 'working', lastSubject: 'audit' }],
        tasks:     [{ taskId: 't1', subject: 'UX audit', status: 'in_progress', teammate: 'ux-researcher' }],
      },
    };
    const json = JSON.parse(buildCard(state));
    const team = json.elements.find(
      (e: any) => e.tag === 'markdown' && typeof e.content === 'string' && /Teammates/.test(e.content),
    );
    expect(team).toBeDefined();
    expect(team.content).toContain('feishu-ux-review');
    expect(team.content).toContain('ux-researcher');
    expect(team.content).toContain('UX audit');
  });

  it('renders pending Agent Team tasks', () => {
    const state: CardState = {
      status: 'running',
      userPrompt: 't',
      responseText: '',
      toolCalls: [],
      teamState: {
        name: 'demo',
        teammates: [{ name: 'lead', status: 'idle' }],
        tasks: [{ taskId: '1', subject: 'Plan work', status: 'pending', teammate: 'lead' }],
      },
    };
    const json = JSON.parse(buildCard(state));
    const team = json.elements.find(
      (e: any) => e.tag === 'markdown' && typeof e.content === 'string' && /Team/.test(e.content),
    );
    expect(team).toBeDefined();
    expect(team.content).toContain('1 pending');
    expect(team.content).toContain('Plan work');
  });
});

describe('buildHelpCard', () => {
  it('returns valid card JSON', () => {
    const json = JSON.parse(buildHelpCard());
    expect(json.header.title.content).toContain('Help');
    expect(json.elements.length).toBeGreaterThan(0);
  });
});

describe('buildStatusCard', () => {
  it('shows session info', () => {
    const json = JSON.parse(buildStatusCard('user123', '/home/user/project', 'sess-abc-12345678', true));
    const md = json.elements[0].content;
    expect(md).toContain('user123');
    expect(md).toContain('/home/user/project');
    expect(md).toContain('sess-abc');
    expect(md).toContain('Yes');
  });

  it('shows no session', () => {
    const json = JSON.parse(buildStatusCard('user', '/home', undefined, false));
    const md = json.elements[0].content;
    expect(md).toContain('None');
    expect(md).toContain('No');
  });
});

describe('buildTextCard', () => {
  it('builds simple text card', () => {
    const json = JSON.parse(buildTextCard('Title', 'Some content', 'green'));
    expect(json.header.template).toBe('green');
    expect(json.header.title.content).toBe('Title');
    expect(json.elements[0].content).toBe('Some content');
  });
});

const questionState = (multiSelect = false): CardState => ({
  status: 'waiting_for_input',
  userPrompt: 'deploy',
  responseText: 'Before deploying...',
  toolCalls: [],
  pendingQuestion: {
    toolUseId: 'q1',
    questions: [{
      question: 'Which env?',
      header: 'Deploy',
      options: [
        { label: 'Production', description: 'Live environment' },
        { label: 'Staging', description: 'Test environment' },
      ],
      multiSelect,
    }],
  },
});

describe('buildCardV2', () => {
  it('never uses the v1 `action` container, which schema 2.0 rejects outright', () => {
    // Feishu answers 200861 "unsupported tag action" for the WHOLE card, so an
    // `action` element doesn't just lose the buttons — the card never renders
    // and the user sees a frozen "Running..." card with no question at all.
    const json = JSON.parse(buildCardV2(questionState()));
    const walk = (node: unknown): unknown[] => {
      if (Array.isArray(node)) return node.flatMap(walk);
      if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        return [o, ...Object.values(o).flatMap(walk)];
      }
      return [];
    };
    expect(json.schema).toBe('2.0');
    expect(walk(json.body).some((n) => (n as Record<string, unknown>).tag === 'action')).toBe(false);
  });

  it('renders option buttons as top-level elements with behaviors callbacks', () => {
    const json = JSON.parse(buildCardV2(questionState()));
    const buttons = json.body.elements.filter((e: any) => e.tag === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text.content).toContain('Production');
    expect(buttons[0].type).toBe('primary');
    expect(buttons[1].type).toBe('default');
    // v1's top-level `value` is silently dropped under schema 2.0.
    expect(buttons[0].value).toBeUndefined();
    expect(buttons[0].behaviors).toEqual([
      { type: 'callback', value: { action: 'answer_question', toolUseId: 'q1', questionIndex: 0, optionIndex: 0 } },
    ]);
    expect(buttons[1].behaviors[0].value.optionIndex).toBe(1);
    // Buttons must come after the question text and before the reply hint.
    const questionIdx = json.body.elements.findIndex(
      (e: any) => e.tag === 'markdown' && String(e.content).includes('Which env?'),
    );
    const hintIdx = json.body.elements.findIndex(
      (e: any) => e.tag === 'markdown' && String(e.content).includes('点击按钮选择'),
    );
    const buttonIdx = json.body.elements.findIndex((e: any) => e.tag === 'button');
    expect(questionIdx).toBeGreaterThanOrEqual(0);
    expect(buttonIdx).toBeGreaterThan(questionIdx);
    expect(hintIdx).toBeGreaterThan(buttonIdx);
  });

  it('hints at number combinations for multi-select questions', () => {
    const findHint = (state: CardState) => {
      const parsed = JSON.parse(buildCardV2(state));
      const marks = parsed.body.elements.filter((e: any) => e.tag === 'markdown');
      return marks[marks.length - 1].content;
    };
    expect(findHint(questionState(true))).toContain('1,3');
    expect(findHint(questionState(false))).not.toContain('1,3');
  });

  it('renders multi-select as toggle buttons plus a gated submit button', () => {
    const buttonsOf = (state: CardState) =>
      JSON.parse(buildCardV2(state)).body.elements.filter((e: any) => e.tag === 'button');

    // Nothing picked yet: options toggle, submit exists but is disabled so a
    // stray click can never resolve the question with an empty answer.
    const fresh = buttonsOf(questionState(true));
    expect(fresh).toHaveLength(3); // 2 options + submit
    expect(fresh[0].behaviors[0].value.action).toBe('toggle_option');
    expect(fresh[1].behaviors[0].value.action).toBe('toggle_option');
    expect(fresh[0].text.content).not.toMatch(/^✓/);
    const submit = fresh[2];
    expect(submit.behaviors[0].value.action).toBe('submit_question');
    expect(submit.behaviors[0].value.optionIndex).toBeUndefined();
    expect(submit.disabled).toBe(true);

    // With picks: ✓ marks, picked options highlighted, submit enabled + counted.
    const state = questionState(true);
    state.pendingQuestion!.selected = ['Staging'];
    const picked = buttonsOf(state);
    expect(picked[0].text.content).toBe('1. Production');
    expect(picked[1].text.content).toBe('✓ 2. Staging');
    expect(picked[1].type).toBe('primary');
    expect(picked[2].disabled).toBe(false);
    expect(picked[2].text.content).toContain('1');

    // Single-select keeps one-click answers and no submit button.
    expect(buttonsOf(questionState(false))).toHaveLength(2);
    expect(buttonsOf(questionState(false))[0].behaviors[0].value.action).toBe('answer_question');
  });
});
