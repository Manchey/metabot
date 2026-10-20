import { afterEach, describe, expect, it } from 'vitest';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

let kit: ServerKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

const WEB_EMAIL = 'flood-sung@xvirobotics.com';

/**
 * Issue a member credential whose botName is email-shaped — that's how
 * trunks mints the t5t-replacement token, and `requireOwner` compares
 * lowercased email-equality against `leaderEmail` / `allowedUsers`.
 */
async function issueMember(k: ServerKit, email: string): Promise<string> {
  const res = await call(k.baseUrl, 'POST', '/admin/credentials/issue', k.adminToken, {
    botName: email,
    ownerName: email,
    role: 'member',
  });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('t5t CLI routes — MR3', () => {
  it('POST /cli/goal as leader Bearer → 200, new Goal appended', async () => {
    kit = await startTestServer('t5t-cli-goal-ok');
    const leader = 'leader@xvirobotics.com';
    const token = await issueMember(kit, leader);
    kit.handle.t5tStore.appendProject(
      { slug: 'proj-a', name: 'A', leaderEmail: leader },
      { botName: 'seed', role: 'admin' } as never,
    );
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/goal', token, {
      project: 'proj-a',
      text: 'ship the thing',
    });
    expect(res.status).toBe(200);
    expect(res.body.project).toBe('proj-a');
    expect(res.body.text).toBe('ship the thing');
    expect(typeof res.body.goalId).toBe('string');

    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/proj-a', token);
    expect(detail.status).toBe(200);
    expect(detail.body.project.goal).toBe('ship the thing');
  });

  it('POST /cli/goal as non-leader Bearer → 403 owner_required', async () => {
    kit = await startTestServer('t5t-cli-goal-403');
    const leader = 'leader@xvirobotics.com';
    kit.handle.t5tStore.appendProject(
      { slug: 'proj-b', name: 'B', leaderEmail: leader },
      { botName: 'seed', role: 'admin' } as never,
    );
    const intruderToken = await issueMember(kit, 'intruder@xvirobotics.com');
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/goal', intruderToken, {
      project: 'proj-b',
      text: 'sneaky goal',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('owner_required');
  });

  it('POST /cli/push with new project slug → auto-creates with caller as leader', async () => {
    kit = await startTestServer('t5t-cli-push-autocreate');
    const me = 'pusher@xvirobotics.com';
    const token = await issueMember(kit, me);
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/push', token, {
      project: 'fresh-proj',
      items: ['first ever push'],
    });
    expect(res.status).toBe(200);
    expect(res.body.project).toBe('fresh-proj');
    expect(res.body.items).toEqual(['first ever push']);

    // Project now exists with caller as leader → caller can set a goal.
    const goal = await call(kit.baseUrl, 'POST', '/api/t5t/cli/goal', token, {
      project: 'fresh-proj',
      text: 'auto-created so I own it',
    });
    expect(goal.status).toBe(200);
    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/fresh-proj', token);
    expect(detail.body.project.leaderEmail).toBe(me);
  });

  it('POST /cli/wip then GET /cli/wip/:slug/:id → roundtrip the WIPItem', async () => {
    kit = await startTestServer('t5t-cli-wip-roundtrip');
    const me = 'wip-owner@xvirobotics.com';
    const token = await issueMember(kit, me);
    // Auto-create via push so caller owns the project.
    await call(kit.baseUrl, 'POST', '/api/t5t/cli/push', token, {
      project: 'wip-proj',
      items: ['bootstrap'],
    });
    await call(kit.baseUrl, 'POST', '/api/t5t/cli/evaluator', token, {
      project: 'wip-proj',
      evaluatorId: 'e1',
      description: 'first evaluator',
    });
    const created = await call(kit.baseUrl, 'POST', '/api/t5t/cli/wip', token, {
      project: 'wip-proj',
      evaluatorId: 'e1',
      description: 'do the work',
      status: 'doing',
    });
    expect(created.status).toBe(200);
    const wipId = created.body.wipId as string;
    expect(typeof wipId).toBe('string');

    const fetched = await call(
      kit.baseUrl,
      'GET',
      `/api/t5t/cli/wip/wip-proj/${encodeURIComponent(wipId)}`,
      token,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.wipId).toBe(wipId);
    expect(fetched.body.description).toBe('do the work');
    expect(fetched.body.status).toBe('doing');

    // Cross-project guess must not leak: wrong slug → 404.
    const wrong = await call(
      kit.baseUrl,
      'GET',
      `/api/t5t/cli/wip/other-proj/${encodeURIComponent(wipId)}`,
      token,
    );
    expect(wrong.status).toBe(404);
  });

  it('owner-auth deny-by-default: empty leader + empty allowedUsers → 403 even for the project author', async () => {
    kit = await startTestServer('t5t-cli-denybydefault');
    const author = 'author@xvirobotics.com';
    const token = await issueMember(kit, author);
    // Author creates an UNOWNED project directly (no leader, no allowedUsers).
    kit.handle.t5tStore.appendProject(
      { slug: 'orphan', name: 'Orphan', leaderEmail: null, allowedUsers: [] },
      { botName: author, role: 'member' } as never,
    );
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/goal', token, {
      project: 'orphan',
      text: 'I made it so surely I can edit it',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('owner_required');
  });

  it('GET /cli/whoami → caller identity (Bearer member)', async () => {
    kit = await startTestServer('t5t-cli-whoami');
    const me = 'who@xvirobotics.com';
    const token = await issueMember(kit, me);
    const res = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', token);
    expect(res.status).toBe(200);
    expect(res.body.canonicalEmail).toBe(me);
    expect(res.body.botName).toBe(me);
    expect(res.body.role).toBe('member');
    expect(res.body.source).toBe('cli');
  });

  it('web-identity is rejected on /api/t5t/cli/* (structural 404, machine-only)', async () => {
    kit = await startTestServer('t5t-cli-web-blocked', { uiAllowedEmails: [WEB_EMAIL] });
    const cases: Array<[string, string, string | undefined]> = [
      ['GET', '/api/t5t/cli/whoami', undefined],
      ['GET', '/api/t5t/cli/board', undefined],
      ['POST', '/api/t5t/cli/push', '{"project":"x","items":["a"]}'],
      ['POST', '/api/t5t/cli/goal', '{"project":"x","text":"y"}'],
    ];
    for (const [m, p, payload] of cases) {
      const res = await rawRequest(
        kit.port,
        m,
        p,
        { 'X-Forwarded-Email': WEB_EMAIL, 'Content-Type': 'application/json' },
        payload,
      );
      expect(res.status, `${m} ${p} must be structural 404`).toBe(404);
      expect(JSON.parse(res.body).error, `${m} ${p}`).toBe('not_found');
    }
  });

  it('POST /cli/kill as leader → 200, project surfaces status=killed; non-leader → 403', async () => {
    kit = await startTestServer('t5t-cli-kill');
    const leader = 'killer@xvirobotics.com';
    const token = await issueMember(kit, leader);
    kit.handle.t5tStore.appendProject(
      { slug: 'doomed', name: 'Doomed', leaderEmail: leader, status: 'yellow' },
      { botName: 'seed', role: 'admin' } as never,
    );

    // Non-leader cannot kill.
    const intruderToken = await issueMember(kit, 'intruder@xvirobotics.com');
    const denied = await call(kit.baseUrl, 'POST', '/api/t5t/cli/kill', intruderToken, {
      project: 'doomed',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('owner_required');

    // Leader can kill.
    const ok = await call(kit.baseUrl, 'POST', '/api/t5t/cli/kill', token, {
      project: 'doomed',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('killed');

    // Detail surfaces the killed status.
    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/doomed', token);
    expect(detail.status).toBe(200);
    expect(detail.body.project.status).toBe('killed');
  });

  it('POST /cli/kill on unknown project → 404 project_not_found', async () => {
    kit = await startTestServer('t5t-cli-kill-404');
    const token = await issueMember(kit, 'whoever@xvirobotics.com');
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/kill', token, {
      project: 'no-such-thing',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('project_not_found');
  });

  it('POST /cli/kill missing body.project → 400 project_required', async () => {
    kit = await startTestServer('t5t-cli-kill-validation');
    const token = await issueMember(kit, 'whoever@xvirobotics.com');
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/kill', token, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_required');
  });

  it('POST /cli/reopen as leader → 200, project surfaces status=unknown; non-leader → 403', async () => {
    kit = await startTestServer('t5t-cli-reopen');
    const leader = 'owner@xvirobotics.com';
    const token = await issueMember(kit, leader);
    kit.handle.t5tStore.appendProject(
      { slug: 'paused', name: 'Paused', leaderEmail: leader, status: 'yellow' },
      { botName: 'seed', role: 'admin' } as never,
    );
    kit.handle.t5tStore.killProject('paused', { botName: 'seed', role: 'admin' } as never);

    const intruderToken = await issueMember(kit, 'intruder@xvirobotics.com');
    const denied = await call(kit.baseUrl, 'POST', '/api/t5t/cli/reopen', intruderToken, {
      project: 'paused',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('owner_required');

    const ok = await call(kit.baseUrl, 'POST', '/api/t5t/cli/reopen', token, {
      project: 'paused',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('unknown');

    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/paused', token);
    expect(detail.status).toBe(200);
    expect(detail.body.project.status).toBe('unknown');
  });

  it('POST /cli/delete only hard-deletes owner smoke projects', async () => {
    kit = await startTestServer('t5t-cli-delete-smoke');
    const owner = 'smoke-owner@xvirobotics.com';
    const ownerToken = await issueMember(kit, owner);
    const intruderToken = await issueMember(kit, 'intruder@xvirobotics.com');
    await call(kit.baseUrl, 'POST', '/api/t5t/cli/push', ownerToken, {
      project: 'smoke-test-proj',
      date: '2026-06-01',
      items: ['temporary smoke entry'],
    });

    const denied = await call(kit.baseUrl, 'POST', '/api/t5t/cli/delete', intruderToken, {
      project: 'smoke-test-proj',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('owner_required');

    const ok = await call(kit.baseUrl, 'POST', '/api/t5t/cli/delete', ownerToken, {
      project: 'smoke-test-proj',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.slug).toBe('smoke-test-proj');
    expect(ok.body.removed.projects).toBe(1);
    expect(ok.body.removed.entries).toBe(1);

    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/smoke-test-proj', ownerToken);
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe('project_not_found');
  });

  it('POST /cli/delete rejects non-smoke projects before deleting anything', async () => {
    kit = await startTestServer('t5t-cli-delete-real');
    const owner = 'real-owner@xvirobotics.com';
    const token = await issueMember(kit, owner);
    await call(kit.baseUrl, 'POST', '/api/t5t/cli/push', token, {
      project: 'real-proj',
      items: ['real entry'],
    });

    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/delete', token, {
      project: 'real-proj',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('only_smoke_projects_can_be_deleted');

    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/real-proj', token);
    expect(detail.status).toBe(200);
  });

  it('POST /cli/topfive as leader Bearer → 200; flip status=done by itemId → done', async () => {
    kit = await startTestServer('t5t-cli-topfive');
    const me = 'tf-owner@xvirobotics.com';
    const token = await issueMember(kit, me);
    await call(kit.baseUrl, 'POST', '/api/t5t/cli/push', token, {
      project: 'tf-cli', items: ['boot'],
    });
    const add = await call(kit.baseUrl, 'POST', '/api/t5t/cli/topfive', token, {
      project: 'tf-cli', text: 'fix the deploy script',
    });
    expect(add.status).toBe(200);
    expect(add.body.itemId).toBe('tf-cli-tf-1');
    expect(add.body.status).toBe('open');

    const flip = await call(kit.baseUrl, 'POST', '/api/t5t/cli/topfive', token, {
      project: 'tf-cli', itemId: add.body.itemId, status: 'done',
    });
    expect(flip.status).toBe(200);
    expect(flip.body.status).toBe('done');

    const detail = await call(kit.baseUrl, 'GET', '/api/t5t/cli/project/tf-cli', token);
    expect(detail.status).toBe(200);
    expect(detail.body.topFive[0].status).toBe('done');
  });

  it('POST /cli/topfive as non-leader → 403 owner_required', async () => {
    kit = await startTestServer('t5t-cli-topfive-403');
    const leader = 'leader@xvirobotics.com';
    kit.handle.t5tStore.appendProject(
      { slug: 'tf-prot', name: 'P', leaderEmail: leader },
      { botName: 'seed', role: 'admin' } as never,
    );
    const intruderToken = await issueMember(kit, 'intruder@xvirobotics.com');
    const res = await call(kit.baseUrl, 'POST', '/api/t5t/cli/topfive', intruderToken, {
      project: 'tf-prot', text: 'sneaky',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('owner_required');
  });

  it('contract validation: missing required field → 400 before any store write', async () => {
    kit = await startTestServer('t5t-cli-validation');
    const token = await issueMember(kit, 'val@xvirobotics.com');
    const noItems = await call(kit.baseUrl, 'POST', '/api/t5t/cli/push', token, {
      project: 'p',
    });
    expect(noItems.status).toBe(400);
    expect(noItems.body.error).toBe('items_required');
    const noText = await call(kit.baseUrl, 'POST', '/api/t5t/cli/goal', token, {
      project: 'p',
    });
    expect(noText.status).toBe(400);
    expect(noText.body.error).toBe('text_required');
  });
});
