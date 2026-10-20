import { afterEach, describe, expect, it } from 'vitest';
import type { Credential } from '../src/auth/credentials.js';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

let kit: ServerKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

const WEB_EMAIL = 'flood-sung@xvirobotics.com';

function mkCred(botName: string, role: Credential['role'] = 'member'): Credential {
  return {
    id: `cred-${botName}`,
    tokenHash: '',
    botName,
    ownerName: botName,
    role,
    writableNamespaces: [],
    readableNamespaces: [],
    publishSkill: false,
    createdAt: 0,
    revokedAt: null,
    lastUsedAt: null,
    notes: '',
  };
}

async function issueMember(k: ServerKit, botName = 'cli-bot'): Promise<string> {
  const res = await call(k.baseUrl, 'POST', '/admin/credentials/issue', k.adminToken, {
    botName,
    ownerName: botName,
    role: 'member',
  });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

/**
 * Seed T5T domain data directly through the store on the running server
 * handle. MR2 ships no project/entry write routes (those land in MR3), so
 * the HTTP read/feedback surface is exercised against store-seeded state.
 */
function seedProject(
  k: ServerKit,
  opts: {
    slug: string;
    name?: string;
    leaderEmail?: string | null;
    allowedUsers?: string[];
    entryItems?: string[];
    entryAuthor?: string;
  },
): { entryDocId: string | null } {
  const store = k.handle.t5tStore;
  const author = mkCred(opts.entryAuthor || 'seed-bot');
  store.appendProject(
    {
      slug: opts.slug,
      name: opts.name,
      leaderEmail: opts.leaderEmail ?? null,
      allowedUsers: opts.allowedUsers ?? [],
    },
    author,
  );
  let entryDocId: string | null = null;
  if (opts.entryItems && opts.entryItems.length) {
    const entry = store.appendEntry(
      { project: opts.slug, items: opts.entryItems },
      author,
    );
    entryDocId = entry.docId;
  }
  return { entryDocId };
}

describe('t5t web routes — MR2', () => {
  it('GET /api/t5t/board as web-identity → 200 with projects + anomalies', async () => {
    kit = await startTestServer('t5t-board-web', { uiAllowedEmails: [WEB_EMAIL] });
    seedProject(kit, {
      slug: 'alpha',
      name: 'Alpha',
      leaderEmail: 'lead@xvirobotics.com',
      entryItems: ['shipped MR1'],
    });
    const res = await rawRequest(kit.port, 'GET', '/api/t5t/board', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects.some((p: { slug: string }) => p.slug === 'alpha')).toBe(true);
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(Array.isArray(body.recentEntries)).toBe(true);
    expect(typeof body.generatedAt).toBe('string');
  });

  it('GET /api/t5t/projects/:slug as web-identity → 200 with detail', async () => {
    kit = await startTestServer('t5t-project-web', { uiAllowedEmails: [WEB_EMAIL] });
    seedProject(kit, {
      slug: 'beta',
      name: 'Beta',
      leaderEmail: 'lead@xvirobotics.com',
      entryItems: ['did a thing'],
    });
    const res = await rawRequest(kit.port, 'GET', '/api/t5t/projects/beta', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.project.slug).toBe('beta');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(1);
    expect(Array.isArray(body.feedback)).toBe(true);
    expect(Array.isArray(body.wipBoard)).toBe(true);
  });

  it('POST /api/t5t/feedback as web-identity → 200, author stamped from X-Forwarded-Email', async () => {
    kit = await startTestServer('t5t-fb-web', { uiAllowedEmails: [WEB_EMAIL] });
    const { entryDocId } = seedProject(kit, {
      slug: 'gamma',
      entryItems: ['entry to comment on'],
    });
    expect(entryDocId).toBeTruthy();
    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/feedback',
      { 'X-Forwarded-Email': WEB_EMAIL, 'Content-Type': 'application/json' },
      JSON.stringify({ onEntry: entryDocId, comment: 'nice work', from: 'spoofed@evil.com' }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    // Author always server-stamped from the synthetic web cred botName
    // (the X-Forwarded-Email), never from the client-supplied `from`.
    expect(body.from).toBe(WEB_EMAIL);
    expect(body.fromCanonical).toBe(WEB_EMAIL);
    expect(body.comment).toBe('nice work');
  });

  it('POST /api/t5t/feedback as Bearer member → 200, author stamped from cred.botName', async () => {
    kit = await startTestServer('t5t-fb-bearer', { uiAllowedEmails: [WEB_EMAIL] });
    const token = await issueMember(kit, 'feedback-bot');
    const { entryDocId } = seedProject(kit, {
      slug: 'delta',
      entryItems: ['bearer entry'],
    });
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/feedback', token, {
      onEntry: entryDocId,
      comment: 'from a bot',
      from: 'ignored@evil.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('feedback-bot');
    expect(res.body.fromCanonical).toBe('feedback-bot');
    expect(res.body.comment).toBe('from a bot');
  });

  it('GET /api/t5t/projects/:slug for project with no leader AND no allowedUsers → still 200 (reads open; owner-auth gates writes only)', async () => {
    kit = await startTestServer('t5t-unowned', { uiAllowedEmails: [WEB_EMAIL] });
    seedProject(kit, {
      slug: 'orphan',
      name: 'Orphan',
      leaderEmail: null,
      allowedUsers: [],
      entryItems: ['unowned but readable'],
    });
    const res = await rawRequest(kit.port, 'GET', '/api/t5t/projects/orphan', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.project.slug).toBe('orphan');
    expect(body.project.leaderEmail).toBeNull();
    expect(body.project.allowedUsers).toEqual([]);
  });

  it('POST /api/t5t/projects/:slug/kill as web-identity leader → 200 status=killed', async () => {
    kit = await startTestServer('t5t-kill-web-leader', { uiAllowedEmails: [WEB_EMAIL] });
    seedProject(kit, {
      slug: 'web-doomed',
      name: 'Web Doomed',
      leaderEmail: WEB_EMAIL,
      entryItems: ['final entry'],
    });
    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/projects/web-doomed/kill',
      { 'X-Forwarded-Email': WEB_EMAIL, 'Content-Type': 'application/json' },
      '{}',
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('killed');
    expect(body.slug).toBe('web-doomed');

    // Detail surfaces the killed state.
    const detail = await rawRequest(kit.port, 'GET', '/api/t5t/projects/web-doomed', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(detail.status).toBe(200);
    expect(JSON.parse(detail.body).project.status).toBe('killed');
  });

  it('POST /api/t5t/projects/:slug/kill as non-leader web-identity → 403', async () => {
    const intruderEmail = 'intruder@xvirobotics.com';
    kit = await startTestServer('t5t-kill-web-403', {
      uiAllowedEmails: [WEB_EMAIL, intruderEmail],
    });
    seedProject(kit, {
      slug: 'web-protected',
      leaderEmail: WEB_EMAIL,
      entryItems: ['x'],
    });
    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/projects/web-protected/kill',
      { 'X-Forwarded-Email': intruderEmail, 'Content-Type': 'application/json' },
      '{}',
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('owner_required');
  });

  it('POST /api/t5t/topfive as web-identity leader → 200; getProject includes topFive[]', async () => {
    kit = await startTestServer('t5t-topfive-web-leader', { uiAllowedEmails: [WEB_EMAIL] });
    seedProject(kit, { slug: 'tfp', leaderEmail: WEB_EMAIL });
    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/topfive',
      { 'X-Forwarded-Email': WEB_EMAIL, 'Content-Type': 'application/json' },
      JSON.stringify({ project: 'tfp', text: 'first hot todo' }),
    );
    expect(res.status).toBe(200);
    const created = JSON.parse(res.body);
    expect(created.itemId).toBe('tfp-tf-1');
    expect(created.status).toBe('open');
    expect(created.author).toBe(WEB_EMAIL);

    const detail = await rawRequest(kit.port, 'GET', '/api/t5t/projects/tfp', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(detail.status).toBe(200);
    const body = JSON.parse(detail.body);
    expect(Array.isArray(body.topFive)).toBe(true);
    expect(body.topFive.length).toBe(1);
    expect(body.topFive[0].text).toBe('first hot todo');
  });

  it('POST /api/t5t/topfive as non-leader web-identity → 403 owner_required', async () => {
    const intruder = 'intruder@xvirobotics.com';
    kit = await startTestServer('t5t-topfive-web-403', {
      uiAllowedEmails: [WEB_EMAIL, intruder],
    });
    seedProject(kit, { slug: 'tfp2', leaderEmail: WEB_EMAIL });
    const res = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/topfive',
      { 'X-Forwarded-Email': intruder, 'Content-Type': 'application/json' },
      JSON.stringify({ project: 'tfp2', text: 'try to add' }),
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('owner_required');
  });

  it('POST /api/t5t/topfive flip status=done by itemId → 200, list reflects done', async () => {
    kit = await startTestServer('t5t-topfive-flip', { uiAllowedEmails: [WEB_EMAIL] });
    seedProject(kit, { slug: 'tfp3', leaderEmail: WEB_EMAIL });
    const add = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/topfive',
      { 'X-Forwarded-Email': WEB_EMAIL, 'Content-Type': 'application/json' },
      JSON.stringify({ project: 'tfp3', text: 'fix the build' }),
    );
    expect(add.status).toBe(200);
    const itemId = JSON.parse(add.body).itemId;
    const flip = await rawRequest(
      kit.port,
      'POST',
      '/api/t5t/topfive',
      { 'X-Forwarded-Email': WEB_EMAIL, 'Content-Type': 'application/json' },
      JSON.stringify({ project: 'tfp3', itemId, status: 'done' }),
    );
    expect(flip.status).toBe(200);
    expect(JSON.parse(flip.body).status).toBe('done');
    const detail = await rawRequest(kit.port, 'GET', '/api/t5t/projects/tfp3', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(JSON.parse(detail.body).topFive[0].status).toBe('done');
  });

  it('anomaly classification: project that has never been pushed shows in anomalies[] with reason:stale', async () => {
    kit = await startTestServer('t5t-stale', { uiAllowedEmails: [WEB_EMAIL] });
    const store = kit.handle.t5tStore;
    const author = mkCred('seed-bot');
    // No entries → lastPush == null → computeAnomalies emits reason:'stale'
    // (detail 'never pushed'). The store is append-only with no time-travel
    // hook, so 'never pushed' is the deterministic stale path; the >7d-age
    // branch is covered in t5t-store.test.ts where `now` is injectable.
    store.appendProject(
      { slug: 'stale-proj', name: 'Stale', leaderEmail: 'lead@xvirobotics.com' },
      author,
    );
    const res = await rawRequest(kit.port, 'GET', '/api/t5t/board', {
      'X-Forwarded-Email': WEB_EMAIL,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    const stale = body.anomalies.filter(
      (a: { project: string; reason: string; detail: string }) =>
        a.project === 'stale-proj' && a.reason === 'stale',
    );
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0].detail).toBe('never pushed');
  });
});
