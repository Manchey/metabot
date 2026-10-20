import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf-8');
const POWERSHELL_INSTALL_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'install.ps1'), 'utf-8');

function extractGenerator(variable: string): string {
  const marker = `${variable}=$(node -e "`;
  const start = INSTALL_SOURCE.indexOf(marker);
  if (start === -1) throw new Error(`Missing ${variable} generator in install.sh`);

  const bodyStart = start + marker.length;
  const bodyEnd = INSTALL_SOURCE.indexOf('\n    " ', bodyStart);
  if (bodyEnd === -1) throw new Error(`Missing end of ${variable} generator in install.sh`);
  return INSTALL_SOURCE.slice(bodyStart, bodyEnd);
}

function extractPowerShellGenerator(variable: string): string {
  const marker = `$${variable} = node -e "`;
  const start = POWERSHELL_INSTALL_SOURCE.indexOf(marker);
  if (start === -1) throw new Error(`Missing ${variable} generator in install.ps1`);

  const bodyStart = start + marker.length;
  const bodyEnd = POWERSHELL_INSTALL_SOURCE.indexOf('" $', bodyStart);
  if (bodyEnd === -1) throw new Error(`Missing end of ${variable} generator in install.ps1`);
  return POWERSHELL_INSTALL_SOURCE.slice(bodyStart, bodyEnd);
}

const platforms = [
  {
    name: 'Feishu',
    generator: extractGenerator('FEISHU_BOTS_JSON'),
    args: ['bot', 'cli_test', 'secret', '/workspace'],
  },
  {
    name: 'Telegram',
    generator: extractGenerator('TELEGRAM_BOTS_JSON'),
    args: ['bot', 'telegram-token', '/workspace'],
  },
  {
    name: 'WeChat',
    generator: extractGenerator('WECHAT_BOTS_JSON'),
    args: ['bot', '/workspace'],
  },
] as const;

const powerShellPlatforms = [
  {
    name: 'PowerShell Feishu',
    generator: extractPowerShellGenerator('FeishuBotsJson'),
    args: ['bot', 'cli_test', 'secret', 'C:\\workspace'],
  },
  {
    name: 'PowerShell Telegram',
    generator: extractPowerShellGenerator('TelegramBotsJson'),
    args: ['bot', 'telegram-token', 'C:\\workspace'],
  },
] as const;

function generateBot(generator: string, args: readonly string[], engine: string): Record<string, unknown> {
  const output = execFileSync(process.execPath, ['-e', generator, ...args, engine], { encoding: 'utf-8' });
  return JSON.parse(output)[0] as Record<string, unknown>;
}

describe('interactive installer engine selection', () => {
  for (const platform of [...platforms, ...powerShellPlatforms]) {
    it(`${platform.name} persists Claude explicitly`, () => {
      const bot = generateBot(platform.generator, platform.args, 'claude');

      expect(bot.engine).toBe('claude');
      expect(bot.kimi).toBeUndefined();
      expect(bot.codex).toBeUndefined();
    });

    it(`${platform.name} preserves Kimi defaults`, () => {
      const bot = generateBot(platform.generator, platform.args, 'kimi');

      expect(bot.engine).toBe('kimi');
      expect(bot.kimi).toEqual({ model: 'kimi-code/k3', thinking: true, permissionMode: 'auto' });
      expect(bot.codex).toBeUndefined();
    });

    it(`${platform.name} preserves Codex defaults`, () => {
      const bot = generateBot(platform.generator, platform.args, 'codex');

      expect(bot.engine).toBe('codex');
      expect(bot.codex).toEqual({ approvalPolicy: 'never', sandbox: 'workspace-write' });
      expect(bot.kimi).toBeUndefined();
    });
  }
});
