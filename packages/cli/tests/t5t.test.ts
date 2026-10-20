import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  // Ensure each test starts from a clean env so loadConfig sees the values
  // the test sets, not values leaked from the developer's shell.
  delete process.env.METABOT_CORE_URL;
  delete process.env.METABOT_CORE_TOKEN;
  // HOME redirect — keep ~/.metabot-core/token from leaking a real token in.
  process.env.HOME = '/tmp/metabot-cli-test-home-does-not-exist';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIG_ENV };
});

async function importFresh(): Promise<typeof import('../src/t5t.js')> {
  // The module caches `loadT5tClient` at import time only through the
  // `run` closure — re-importing per test gives each test a fresh fetch mock.
  vi.resetModules();
  return await import('../src/t5t.js');
}

function mockOk(json: unknown): typeof fetch {
  return vi.fn(async () => {
    const text = JSON.stringify(json);
    return new Response(text, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('metabot t5t — argv parsing + dispatch', () => {
  it('--help prints usage without needing a token', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const mod = await importFresh();
    await mod.run(['--help']);
    const printed = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toMatch(/metabot t5t — daily team status/);
    expect(printed).toMatch(/board\b/);
    expect(printed).toMatch(/push <project> <YYYY-MM-DD>/);
  });

  it('bare invocation prints usage', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const mod = await importFresh();
    await mod.run([]);
    const printed = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toMatch(/metabot t5t —/);
  });

  it('missing token: clean error from loadConfig', async () => {
    const mod = await importFresh();
    await expect(mod.run(['whoami'])).rejects.toThrow(/no token configured/);
  });

  it('board → GET /api/t5t/cli/board with Bearer header', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ generatedAt: 't', projects: [], recentEntries: [], anomalies: [] });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['board']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/board');
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer mt_test_tok');
  });

  it('push validates ISO date + at least one item', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    vi.stubGlobal('fetch', mockOk({ ok: true }));
    const mod = await importFresh();

    await expect(mod.run(['push', 'slug', 'not-a-date', 'x'])).rejects.toThrow(/YYYY-MM-DD/);
    await expect(mod.run(['push', 'slug', '2026-05-19'])).rejects.toThrow(/at least one/);
  });

  it('push posts {project, date, items} to /api/t5t/cli/push', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ docId: 'd1', project: 'p', items: ['a', 'b'] });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['push', 'my-proj', '2026-05-19', 'wrote spec', 'shipped MR1']);

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/push');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      project: 'my-proj',
      date: '2026-05-19',
      items: ['wrote spec', 'shipped MR1'],
    });
  });

  it('feedback parses --mentions into an array', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ feedbackId: 'fb1' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['feedback', 'entry-doc-abc', 'looks good', '--mentions', '@alice,@bob']);

    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect(JSON.parse(String(init.body))).toEqual({
      onEntry: 'entry-doc-abc',
      comment: 'looks good',
      mentions: ['@alice', '@bob'],
    });
  });

  it('evaluator add/remove maps to {evaluatorId, met} body', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['evaluator', 'slug', 'add', 'alice@xvirobotics.com']);

    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    const body = JSON.parse(String(init.body));
    expect(body.project).toBe('slug');
    expect(body.evaluatorId).toBe('alice@xvirobotics.com');
    expect(body.met).toBe(true);

    await mod.run(['evaluator', 'slug', 'remove', 'alice@xvirobotics.com']);
    const init2 = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1]![1];
    expect(JSON.parse(String(init2.body)).met).toBe(false);
  });

  it('evaluator rejects unknown action', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    vi.stubGlobal('fetch', mockOk({}));
    const mod = await importFresh();
    await expect(
      mod.run(['evaluator', 'slug', 'pivot', 'alice@xvirobotics.com']),
    ).rejects.toThrow(/add' or 'remove/);
  });

  it('bottleneck --clear posts {clear:true} without text', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['bottleneck', 'slug', '--clear']);

    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect(JSON.parse(String(init.body))).toEqual({ project: 'slug', clear: true });
  });

  it('owner_required surfaces as a clean error', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'owner_required' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const mod = await importFresh();
    await expect(mod.run(['goal', 'slug', 'be excellent'])).rejects.toThrow(/403.*owner_required/);
  });

  it('kill <project> posts {project} to /api/t5t/cli/kill', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ slug: 'doomed', status: 'killed' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['kill', 'doomed']);

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/kill');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ project: 'doomed' });
  });

  it('kill without <project> throws clean error', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    vi.stubGlobal('fetch', mockOk({}));
    const mod = await importFresh();
    await expect(mod.run(['kill'])).rejects.toThrow(/<project> required/);
  });

  it('reopen <project> posts {project} to /api/t5t/cli/reopen', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ slug: 'paused', status: 'unknown' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['reopen', 'paused']);

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/reopen');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ project: 'paused' });
  });

  it('delete <smoke-project> posts {project} to /api/t5t/cli/delete', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ slug: 'smoke-test-proj', removed: { total: 2 } });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['delete', 'smoke-test-proj']);

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ project: 'smoke-test-proj' });
  });

  it('delete rejects non-smoke projects client-side', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    const fetchMock = mockOk({});
    vi.stubGlobal('fetch', fetchMock);
    const mod = await importFresh();

    await expect(mod.run(['delete', 'real-proj'])).rejects.toThrow(/only smoke\*/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('projects show <slug> hits /api/t5t/cli/project/:slug', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ project: { slug: 'my' }, entries: [], feedback: [], wipBoard: [] });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['projects', 'show', 'my proj']);

    const [url] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/project/my%20proj');
  });

  it('top5 add posts {project, text} to /api/t5t/cli/topfive', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ itemId: 'p-tf-1', status: 'open' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['top5', 'my-proj', 'add', 'fix the deploy script']);

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/topfive');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      project: 'my-proj',
      text: 'fix the deploy script',
    });
  });

  it('top5 done|reopen|remove posts {project, itemId, status}', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({ itemId: 'p-tf-1', status: 'done' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['top5', 'my-proj', 'done', 'p-tf-1']);
    await mod.run(['top5', 'my-proj', 'reopen', 'p-tf-1']);
    await mod.run(['top5', 'my-proj', 'remove', 'p-tf-1']);

    const calls = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(JSON.parse(String(calls[0]![1].body)).status).toBe('done');
    expect(JSON.parse(String(calls[1]![1].body)).status).toBe('open');
    expect(JSON.parse(String(calls[2]![1].body)).status).toBe('removed');
  });

  it('top5 list reads project detail and prints topFive', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    process.env.METABOT_CORE_URL = 'https://example.test/core';
    const fetchMock = mockOk({
      project: { slug: 'my-proj' },
      entries: [],
      feedback: [],
      wipBoard: [],
      topFive: [{ itemId: 'my-proj-tf-1', text: 'fix deploy', status: 'open' }],
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const mod = await importFresh();
    await mod.run(['top5', 'my-proj', 'list']);

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://example.test/core/api/t5t/cli/project/my-proj');
    expect(init.method).toBe('GET');
  });

  it('top5 rejects unknown action', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    vi.stubGlobal('fetch', mockOk({}));
    const mod = await importFresh();
    await expect(
      mod.run(['top5', 'my-proj', 'pivot', 'fix']),
    ).rejects.toThrow(/unknown action 'pivot'/);
  });

  it('unknown subcommand prints to stderr and exits 2', async () => {
    process.env.METABOT_CORE_TOKEN = 'mt_test_tok';
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}`);
    }) as never);

    const mod = await importFresh();
    await expect(mod.run(['lol-no'])).rejects.toThrow(/__exit_2/);
    expect(stderr).toHaveBeenCalled();
    const printedErr = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(printedErr).toMatch(/unknown subcommand 'lol-no'/);
    expect(stdout.mock.calls.map((c) => String(c[0])).join('')).toMatch(/metabot t5t —/);
    expect(exit).toHaveBeenCalledWith(2);
  });
});
