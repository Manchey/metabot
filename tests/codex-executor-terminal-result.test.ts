import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexExecutor } from '../src/engines/codex/executor.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;

describe('CodexExecutor terminal result handling', () => {
  it('finishes the stream and reaps Codex when the CLI hangs after turn.completed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metabot-codex-hang-'));
    const executable = join(dir, 'codex');
    const pidFile = join(dir, 'pid');
    writeFileSync(
      executable,
      `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\nprintf '%s\\n' '{"type":"thread.started","thread_id":"thread-1"}'\nprintf '%s\\n' '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"done"}}'\nprintf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}'\nwhile true; do sleep 1; done\n`,
    );
    chmodSync(executable, 0o755);

    try {
      const executor = new CodexExecutor({ codex: { executable, model: 'test-model' } } as any, logger);
      const messages: any[] = [];
      const startedAt = Date.now();
      for await (const message of executor.execute({
        prompt: 'test',
        cwd: dir,
        abortController: new AbortController(),
      })) {
        messages.push(message);
      }

      expect(Date.now() - startedAt).toBeLessThan(900);
      expect(messages.at(-1)).toMatchObject({ type: 'result', result: 'done', is_error: false });

      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
