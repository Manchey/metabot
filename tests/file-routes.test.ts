import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFileRoutes } from '../src/api/routes/file-routes.js';
import type { RouteContext } from '../src/api/routes/types.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

function makeReq(body = ''): any {
  const req = new EventEmitter() as any;
  req.headers = { host: 'localhost' };
  req.destroy = vi.fn();
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

function makeRes(): any {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0),
    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body?: string | Buffer) {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
    },
    json() {
      return JSON.parse(this.body.toString('utf8'));
    },
  };
}

describe('handleFileRoutes managed paths', () => {
  const uploadsRoot = path.join(os.tmpdir(), 'metabot-uploads');
  let siblingDir: string;
  let chatId: string;

  const ctx = { logger } as RouteContext;

  beforeEach(() => {
    siblingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metabot-uploads-outside-'));
    chatId = `file-routes-${path.basename(siblingDir)}`;
  });

  afterEach(() => {
    fs.rmSync(siblingDir, { recursive: true, force: true });
    fs.rmSync(path.join(uploadsRoot, chatId), { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('rejects upload chat IDs that escape the uploads root', async () => {
    const escapedChatId = `../${path.basename(siblingDir)}`;
    const res = makeRes();

    const handled = await handleFileRoutes(
      ctx,
      makeReq('attacker-controlled'),
      res,
      'POST',
      `/api/upload?filename=written.txt&chatId=${encodeURIComponent(escapedChatId)}`,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(path.join(siblingDir, 'written.txt'))).toBe(false);
  });

  it('rejects file reads from a sibling directory with the same path prefix', async () => {
    fs.writeFileSync(path.join(siblingDir, 'secret.txt'), 'outside secret');
    const filePart = `../${path.basename(siblingDir)}/secret.txt`;
    const res = makeRes();

    await handleFileRoutes(ctx, makeReq(), res, 'GET', `/api/files/${encodeURIComponent(filePart)}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.toString('utf8')).toBe('Forbidden');
  });

  it('rejects preview reads from a sibling directory with the same path prefix', async () => {
    fs.writeFileSync(path.join(siblingDir, 'secret.docx'), 'outside secret');
    const filePart = `../${path.basename(siblingDir)}/secret.docx`;
    const res = makeRes();

    await handleFileRoutes(ctx, makeReq(), res, 'GET', `/api/files/preview/${encodeURIComponent(filePart)}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.toString('utf8')).toBe('Forbidden');
  });

  it('keeps legitimate upload and file reads working', async () => {
    const uploadRes = makeRes();
    await handleFileRoutes(
      ctx,
      makeReq('hello'),
      uploadRes,
      'POST',
      `/api/upload?filename=hello.txt&chatId=${encodeURIComponent(chatId)}`,
    );

    expect(uploadRes.statusCode).toBe(200);
    expect(uploadRes.json()).toMatchObject({ filename: 'hello.txt', size: 5 });

    const readRes = makeRes();
    await handleFileRoutes(ctx, makeReq(), readRes, 'GET', `/api/files/${encodeURIComponent(chatId)}/hello.txt`);

    expect(readRes.statusCode).toBe(200);
    expect(readRes.body.toString('utf8')).toBe('hello');
  });
});
