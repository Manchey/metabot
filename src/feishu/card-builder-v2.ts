/**
 * Feishu Card 2.0 schema builder
 *
 * Coexists with card-builder.ts (v1), switched via CARD_SCHEMA_V2 env var.
 *
 * Key improvements over v1:
 *   - Markdown headings → div + lark_md for proper heading rendering
 *   - Markdown tables  → native tag: 'table' (scrollable, aligned, styled)
 *   - Footer stats     → column_set with grey background panel
 *   - Code blocks      → markdown ``` fences (Feishu v2 doesn't support
 *     tag: 'code' / 'code_block' — returns 400 "not support tag")
 *
 * What doesn't work in Feishu v2 (documented for future reference):
 *   - text_size on markdown element: silently ignored
 *   - <font size="N"> in markdown: ignored
 *   - tag: 'code' / 'code_block': 400 error
 *   - tag: 'note': deprecated in v2
 */
import type { CardState } from '../types.js';
import { parseMarkdownToBlocks, type Block } from './markdown-parser.js';
import {
  STATUS_CONFIG,
  BG_ICON,
  truncate,
  truncateContent,
} from './card-builder-utils.js';

// v2-only constant: font size used in the grey stats footer panel.
const FOOTER_FONT_SIZE = 2;

function blockToElement(block: Block): unknown {
  switch (block.type) {
    case 'heading':
      return {
        tag: 'div',
        text: {
          tag:     'lark_md',
          content: '#'.repeat(block.level) + ' ' + block.text,
        },
      };

    case 'table': {
      // data_type 'lark_md' (Feishu 7.10+) so `**bold**`, links, and other
      // inline markdown inside header/cell text actually render. With
      // 'text' the `**` syntax leaks through as literal asterisks because
      // text columns do not parse markdown — that's why mobile table
      // headers were rendering `**品类**` verbatim.
      const columns = block.headers.map((h, i) => ({
        name:             `col${i}`,
        display_name:     h,
        data_type:        'lark_md',
        horizontal_align: block.align[i] ?? 'left',
        vertical_align:   'center',
        width:            'auto',
      }));
      const rows = block.rows.map((row) => {
        const obj: Record<string, string> = {};
        row.forEach((cell, i) => { obj[`col${i}`] = cell; });
        return obj;
      });
      return {
        tag:       'table',
        page_size: 10,
        row_height: 'low',
        header_style: {
          text_align:       'center',
          background_style: 'grey',
          bold:             true,
          lines:            1,
        },
        columns,
        rows,
      };
    }

    case 'codeblock':
      return {
        tag:     'markdown',
        content: '```\n' + block.code + '\n```',
      };

    case 'hr':
      return { tag: 'hr' };

    case 'markdown':
      return {
        tag:        'markdown',
        content:    block.text,
        text_align: 'left',
      };
  }
}

/** Split response text into blocks then map to v2 card elements */
function responseToElements(text: string): unknown[] {
  const truncated = truncateContent(text);
  const blocks    = parseMarkdownToBlocks(truncated);
  return blocks.map(blockToElement);
}

export function buildCardV2(state: CardState): string {
  const config   = STATUS_CONFIG[state.status];
  const elements: unknown[] = [];

  // Goal badge — pinned at the top so users see at a glance that the session
  // is in goal-driven mode (Claude /goal). Persists across turns until /goal
  // clear or /reset. Mirrors v1 builder; do not remove without restoring
  // equivalent rendering or the /goal feature becomes invisible.
  if (state.goalCondition) {
    elements.push({
      tag:     'markdown',
      content: `🎯 **Goal:** ${truncate(state.goalCondition, 200)}`,
    });
    elements.push({ tag: 'hr' });
  }

  // Agent Teams panel — teammates + shared task list. Driven by Claude
  // Code's TaskCreated / TaskCompleted / TeammateIdle hooks. Mirrors v1
  // builder; removing this hides the entire Agent Teams UI from users.
  if (state.teamState && (state.teamState.teammates.length > 0 || state.teamState.tasks.length > 0)) {
    const ts    = state.teamState;
    const lines: string[] = [];
    const header = ts.name ? `🧑‍🤝‍🧑 **Team:** \`${ts.name}\`` : '🧑‍🤝‍🧑 **Team**';
    lines.push(header);
    if (ts.teammates.length > 0) {
      lines.push('');
      lines.push('**Teammates:**');
      for (const m of ts.teammates) {
        const icon = m.status === 'working' ? '⏳' : '💤';
        const subj = m.lastSubject ? ` — _${truncate(m.lastSubject, 60)}_` : '';
        lines.push(`${icon} \`${m.name}\` (${m.status})${subj}`);
      }
    }
    if (ts.tasks.length > 0) {
      // Show in-progress first, then the most recent completions
      const pending    = ts.tasks.filter((t) => t.status === 'pending');
      const inProgress = ts.tasks.filter((t) => t.status === 'in_progress');
      const completed  = ts.tasks.filter((t) => t.status === 'completed').slice(-5);
      lines.push('');
      lines.push(`**Tasks:** ${pending.length} pending · ${inProgress.length} in progress · ${ts.tasks.filter((t) => t.status === 'completed').length} done`);
      for (const t of pending) {
        const owner = t.teammate ? ` → \`${t.teammate}\`` : '';
        lines.push(`◻️ ${truncate(t.subject, 80)}${owner}`);
      }
      for (const t of inProgress) {
        const owner = t.teammate ? ` → \`${t.teammate}\`` : '';
        lines.push(`⏳ ${truncate(t.subject, 80)}${owner}`);
      }
      for (const t of completed) {
        const owner = t.teammate ? ` (\`${t.teammate}\`)` : '';
        lines.push(`✅ ${truncate(t.subject, 80)}${owner}`);
      }
    }
    elements.push({ tag: 'markdown', content: lines.join('\n') });
    elements.push({ tag: 'hr' });
  }

  // Tool calls indicator — single line, no per-tool list.
  // Users repeatedly told us the running tool list is noise; they only care
  // about the final answer. We still show ONE line while the turn is in
  // flight so a hung run is visibly hung instead of looking like a frozen
  // card, but we hide the section completely once the turn is complete/
  // errored. Web UI keeps its own collapsible per-tool view (see
  // packages/web-ui/src/routes/chat.tsx); this only affects the
  // Feishu surface.
  // Keep the summary on an empty successful turn. Hiding it on every
  // completed card assumes a final response body exists; tool-only turns
  // would otherwise render as a blank "Complete" card with only the footer.
  if (
    state.toolCalls.length > 0 &&
    state.status !== 'error' &&
    (state.status !== 'complete' || !state.responseText.trim())
  ) {
    const last  = state.toolCalls[state.toolCalls.length - 1];
    const icon  = last.status === 'running' ? '⏳' : '✅';
    const total = state.toolCalls.length;
    elements.push({
      tag:     'markdown',
      content: `${icon} **${last.name}** · ${total} tool${total > 1 ? 's' : ''}`,
    });
    elements.push({ tag: 'hr' });
  }

  // Background tasks (Monitor, etc.)
  if (state.backgroundEvents && state.backgroundEvents.length > 0) {
    const lines = state.backgroundEvents.map((ev) => {
      const icon    = BG_ICON[ev.status];
      const shortId = ev.taskId.slice(0, 6);
      const desc    = truncate(ev.description, 60);
      const last    = ev.lastEvent ? ` — _${truncate(ev.lastEvent, 140)}_` : '';
      return `${icon} **${desc}** \`${shortId}\`${last}`;
    });
    elements.push({
      tag:     'markdown',
      content: '📡 **Background**\n' + lines.join('\n'),
    });
    elements.push({ tag: 'hr' });
  }

  // Response content (parsed into blocks)
  if (state.responseText) {
    elements.push(...responseToElements(state.responseText));
  } else if (state.status === 'thinking') {
    elements.push({
      tag:     'markdown',
      content: '_Thinking..._',
    });
  }

  if (state.pendingQuestion) {
    elements.push({ tag: 'hr' });
    const picked = state.pendingQuestion.selected ?? [];
    state.pendingQuestion.questions.forEach((q, qi) => {
      const descLines = q.options.map(
        (opt, i) => `**${i + 1}.** ${opt.label} — _${opt.description}_`,
      );
      elements.push({
        tag:     'markdown',
        content: [
          `**[${q.header}] ${q.question}**${q.multiSelect ? ' （可多选，选好后点「提交选择」）' : ''}`,
          '',
          ...descLines,
        ].join('\n'),
      });
      // Schema 2.0 has no `action` container (it makes the whole card invalid —
      // see the header note), so each option becomes a top-level `button`
      // element. Callbacks must travel through `behaviors`; the v1 top-level
      // `value` field is silently dropped under schema 2.0.
      //
      // Multi-select can't be expressed by a single click, so option buttons
      // only toggle their own state (`toggle_option`) and a separate
      // `submit_question` button commits the set. Submit is disabled while
      // nothing is picked, so a click can never resolve the question by accident.
      const cb = (action: string, optionIndex: number | undefined) => ({
        type: 'callback',
        value: {
          action,
          toolUseId:     state.pendingQuestion!.toolUseId,
          questionIndex: qi,
          ...(optionIndex === undefined ? {} : { optionIndex }),
        },
      });
      q.options.forEach((opt, oi) => {
        const on = q.multiSelect && picked.includes(opt.label);
        elements.push({
          tag:  'button',
          text: { tag: 'plain_text', content: `${on ? '✓ ' : ''}${oi + 1}. ${truncate(opt.label, 24)}` },
          type: (!q.multiSelect && oi === 0) || on ? 'primary' : 'default',
          behaviors: [cb(q.multiSelect ? 'toggle_option' : 'answer_question', oi)],
        });
      });
      if (q.multiSelect) {
        elements.push({
          tag:      'button',
          text:     { tag: 'plain_text', content: `✅ 提交选择${picked.length ? `（${picked.length}）` : ''}` },
          type:     'primary',
          disabled: picked.length === 0,
          behaviors: [cb('submit_question', undefined)],
        });
      }
    });
    const multi = state.pendingQuestion.questions.some((q) => q.multiSelect);
    elements.push({
      tag:     'markdown',
      content: multi
        ? '_多选题：点击多个选项后按「提交选择」；也可直接输入编号组合（如 `1,3`）或自定义答案。单选题点击按钮即作答。_'
        : '_点击按钮选择；也可请回复数字（1/2/…）或直接输入自定义答案_',
    });
  }

  // Error message
  if (state.errorMessage) {
    elements.push({
      tag:     'markdown',
      content: `**Error:** ${state.errorMessage}`,
    });
  }

  // Stats footer — grey background panel
  {
    const parts: string[] = [];
    if (state.totalTokens && state.contextWindow) {
      const pct    = Math.round((state.totalTokens / state.contextWindow) * 100);
      const tokensK = state.totalTokens >= 1000
        ? `${(state.totalTokens / 1000).toFixed(1)}k`
        : `${state.totalTokens}`;
      const ctxK = `${Math.round(state.contextWindow / 1000)}k`;
      const color = pct >= 80 ? '🟥' : pct >= 50 ? '🟧' : '🟩';
      const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
      parts.push(`${color} ${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ctx: ${tokensK}/${ctxK} (${pct}%)`);
    }
    if (state.status === 'complete' || state.status === 'error') {
      if (state.sessionCostUsd != null) parts.push(`$${state.sessionCostUsd.toFixed(2)}`);
      if (state.model) parts.push(state.model.replace(/^claude-/, ''));
      if (state.durationMs !== undefined) parts.push(`${(state.durationMs / 1000).toFixed(1)}s`);
    }
    if (parts.length > 0) {
      elements.push({
        tag:               'column_set',
        background_style:  'grey',
        margin:            '12px 0px 0px 0px',
        horizontal_spacing: '0px',
        columns: [
          {
            tag:            'column',
            width:          'weighted',
            weight:         1,
            vertical_align: 'center',
            padding:        '6px 12px 6px 12px',
            elements: [
              {
                tag:        'markdown',
                content:    `<font color="grey" size="${FOOTER_FONT_SIZE}">_${parts.join(' | ')}_</font>`,
                text_align: 'right',
              },
            ],
          },
        ],
      });
    }
  }

  const card = {
    schema: '2.0',
    config: {
      streaming_mode: false,
      enable_forward: true,
      update_multi:   true,
      summary: {
        content: state.responseText
          ? state.responseText.replace(/[\r\n]+/g, ' ').slice(0, 60)
          : config.title,
      },
    },
    header: {
      template: config.color,
      title: {
        tag:     'plain_text',
        content: `${config.icon} ${config.title}`,
      },
    },
    body: {
      direction:        'vertical',
      vertical_spacing: '4px',
      elements,
    },
  };

  return JSON.stringify(card);
}

/** v2 help card */
export function buildHelpCardV2(): string {
  const card = {
    schema: '2.0',
    config: { enable_forward: true, update_multi: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '📖 Help' },
    },
    body: {
      direction: 'vertical',
      elements: [
        {
          tag:     'markdown',
          content: [
            '**Available Commands:**',
            '`/reset` - Clear session, start fresh',
            '`/stop` - Abort current running task',
            '`/status` - Show current session info',
            '`/memory` - Memory document commands',
            '`/help` - Show this help message',
            '',
            '**Usage:**',
            'Send any text message to start a conversation with Claude Code.',
            'Each chat has an independent session with a fixed working directory.',
          ].join('\n'),
        },
      ],
    },
  };
  return JSON.stringify(card);
}

/** v2 status card */
export function buildStatusCardV2(
  userId: string,
  workingDirectory: string,
  sessionId: string | undefined,
  isRunning: boolean,
): string {
  const card = {
    schema: '2.0',
    config: { enable_forward: true, update_multi: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '📊 Status' },
    },
    body: {
      direction: 'vertical',
      elements: [
        {
          tag:     'markdown',
          content: [
            `**User:** \`${userId}\``,
            `**Working Directory:** \`${workingDirectory}\``,
            `**Session:** ${sessionId ? `\`${sessionId.slice(0, 8)}...\`` : '_None_'}`,
            `**Running:** ${isRunning ? 'Yes ⏳' : 'No'}`,
          ].join('\n'),
        },
      ],
    },
  };
  return JSON.stringify(card);
}

/** v2 generic text card */
export function buildTextCardV2(title: string, content: string, color: string = 'blue'): string {
  const card = {
    schema: '2.0',
    config: { enable_forward: true, update_multi: true },
    header: {
      template: color,
      title: { tag: 'plain_text', content: title },
    },
    body: {
      direction: 'vertical',
      elements: [
        {
          tag: 'markdown',
          content,
        },
      ],
    },
  };
  return JSON.stringify(card);
}
