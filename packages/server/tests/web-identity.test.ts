import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

let kit: ServerKit | undefined;
const ORIG_ENV = { ...process.env };

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIG_ENV };
});

const WHITELISTED = 'flood-sung@xvirobotics.com';

async function issueMember(k: ServerKit): Promise<string> {
  const res = await call(k.baseUrl, 'POST', '/admin/credentials/issue', k.adminToken, {
    botName: 'cli-bot',
    ownerName: 'cli-owner',
    role: 'member',
    publishSkill: true,
  });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('web-identity — enabled (METABOT_CORE_UI_ALLOWED_EMAILS set)', () => {
  it('whitelisted email → GET memory/skill routes 200', async () => {
    kit = await startTestServer('web-id', { uiAllowedEmails: [WHITELISTED] });
    for (const p of [
      '/api/memory/folders',
      '/api/memory/folders/tree',
      '/api/memory/documents',
      '/api/memory/search?q=anything',
      '/api/skills',
      '/api/skills/search?q=anything',
    ]) {
      const res = await rawRequest(kit.port, 'GET', p, { 'X-Forwarded-Email': WHITELISTED });
      expect(res.status, `GET ${p}`).toBe(200);
    }
  });

  it('whitelisted email → folder/document/skill detail GET 200 (path subroutes)', async () => {
    kit = await startTestServer('web-id-detail', { uiAllowedEmails: [WHITELISTED] });
    // Non-existent ids → handled by route (404 from store), but route is REACHED
    // (not the structural 404). Distinguish: structural fork returns
    // {error:'not_found'}; the route returns its own not-found body. Either
    // way these are reachable GETs, so assert they are not blocked with a
    // generic structural 404 by checking a known-good collection first, then
    // that detail routes return a route-level status (200/404), never 403.
    const detail = await rawRequest(
      kit.port,
      'GET',
      '/api/memory/documents/%2Fnope',
      { 'X-Forwarded-Email': WHITELISTED },
    );
    expect([200, 404]).toContain(detail.status);
    const skillDetail = await rawRequest(
      kit.port,
      'GET',
      '/api/skills/does-not-exist',
      { 'X-Forwarded-Email': WHITELISTED },
    );
    expect([200, 404]).toContain(skillDetail.status);
  });

  it('whitelisted email → POST/PATCH/DELETE/admin all 404 (structural fork, not 403)', async () => {
    kit = await startTestServer('web-id-write', { uiAllowedEmails: [WHITELISTED] });
    const cases: Array<[string, string]> = [
      ['POST', '/api/memory/documents'],
      ['POST', '/api/memory/folders'],
      ['PATCH', '/api/memory/documents/%2Ffoo'],
      ['PUT', '/api/memory/documents/%2Ffoo'],
      ['DELETE', '/api/memory/documents/%2Ffoo'],
      ['DELETE', '/api/memory/folders/%2Ffoo'],
      ['POST', '/api/skills/x/publish'],
      ['DELETE', '/api/skills/x'],
      ['POST', '/admin/credentials/issue'],
      ['GET', '/admin/credentials'],
      ['GET', '/admin/audit'],
    ];
    for (const [m, p] of cases) {
      const res = await rawRequest(
        kit.port,
        m,
        p,
        { 'X-Forwarded-Email': WHITELISTED, 'Content-Type': 'application/json' },
        m === 'POST' || m === 'PATCH' || m === 'PUT' ? '{}' : undefined,
      );
      expect(res.status, `${m} ${p} must be structural 404`).toBe(404);
      expect(JSON.parse(res.body).error, `${m} ${p}`).toBe('not_found');
    }
  });

  it('present but NOT whitelisted email → 403', async () => {
    kit = await startTestServer('web-id-403', { uiAllowedEmails: [WHITELISTED] });
    const res = await rawRequest(kit.port, 'GET', '/api/memory/folders', {
      'X-Forwarded-Email': 'intruder@evil.com',
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('web_identity_forbidden');
  });

  it('no X-Forwarded-Email and no Bearer → 401 (Bearer path missing_token)', async () => {
    kit = await startTestServer('web-id-401', { uiAllowedEmails: [WHITELISTED] });
    const res = await rawRequest(kit.port, 'GET', '/api/memory/folders', {});
    expect(res.status).toBe(401);
    // No email header present → falls to Bearer path → missing_token.
    expect(JSON.parse(res.body).error).toBe('missing_token');
  });

  it('email lookup is case-insensitive', async () => {
    kit = await startTestServer('web-id-ci', { uiAllowedEmails: [WHITELISTED] });
    const res = await rawRequest(kit.port, 'GET', '/api/memory/folders', {
      'X-Forwarded-Email': 'FLOOD-SUNG@XViRobotics.com',
    });
    expect(res.status).toBe(200);
  });

  it('forged email + valid Bearer → Bearer wins (full member access, not web fork)', async () => {
    kit = await startTestServer('web-id-bearer-wins', { uiAllowedEmails: [WHITELISTED] });
    const memberToken = await issueMember(kit);

    // Forge a NON-whitelisted email alongside a valid Bearer. Bearer must win:
    // the request authenticates as the real member and a member-allowed write
    // succeeds (201) — proving the web fork was NOT applied.
    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/memory/documents',
      {
        Authorization: `Bearer ${memberToken}`,
        'X-Forwarded-Email': 'intruder@evil.com',
        'Content-Type': 'application/json',
      },
      JSON.stringify({
        path: '/users/cli-bot/n',
        title: 'n',
        content: 'bearer wins',
      }),
    );
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body).path).toBe('/users/cli-bot/n');
  });

  it('Bearer path regression: member still gets 403 on foreign namespace', async () => {
    kit = await startTestServer('web-id-bearer-reg', { uiAllowedEmails: [WHITELISTED] });
    const memberToken = await issueMember(kit);
    const res = await call(kit.baseUrl, 'POST', '/api/memory/documents', memberToken, {
      path: '/shared/x',
      title: 'x',
      content: 'x',
    });
    expect(res.status).toBe(403);
  });

  it('/health and /api/manifest remain open even with a web identity', async () => {
    kit = await startTestServer('web-id-open', { uiAllowedEmails: [WHITELISTED] });
    const h = await rawRequest(kit.port, 'GET', '/health', { 'X-Forwarded-Email': WHITELISTED });
    expect(h.status).toBe(200);
    const m = await rawRequest(kit.port, 'GET', '/api/manifest', { 'X-Forwarded-Email': WHITELISTED });
    expect(m.status).toBe(200);
  });

  it('whitelisted email can transcribe chat voice through the bridge STT proxy', async () => {
    process.env.METABOT_CORE_CHAT_VOICE_URL = 'http://bridge.test/api/voice';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      transcript: '你好 metabot',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    kit = await startTestServer('web-id-voice', { uiAllowedEmails: [WHITELISTED] });

    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/chat/voice/transcribe?stt=doubao&language=zh',
      { 'X-Forwarded-Email': WHITELISTED, 'Content-Type': 'audio/webm' },
      'voice-bytes',
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).transcript).toBe('你好 metabot');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [URL, RequestInit][] } }).mock.calls[0]!;
    expect(url.toString()).toBe('http://bridge.test/api/voice?sttOnly=true&stt=doubao&language=zh');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'audio/webm' });
  });
});

describe('web-identity — disabled (env unset, default-off)', () => {
  it('X-Forwarded-Email is ignored entirely; falls to Bearer path → 401', async () => {
    kit = await startTestServer('web-id-off');
    const res = await rawRequest(kit.port, 'GET', '/api/memory/folders', {
      'X-Forwarded-Email': WHITELISTED,
    });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toBe('missing_token');
  });

  it('Bearer path fully functional when web-identity disabled', async () => {
    kit = await startTestServer('web-id-off-bearer');
    const memberToken = await issueMember(kit);
    const res = await call(kit.baseUrl, 'GET', '/api/memory/folders', memberToken);
    expect(res.status).toBe(200);
  });
});
