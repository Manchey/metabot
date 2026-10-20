import { afterEach, describe, expect, it } from 'vitest';
import { call, rawRequest, startTestServer, type ServerKit } from './helpers.js';

let kit: ServerKit | undefined;

afterEach(async () => {
  await kit?.cleanup();
  kit = undefined;
});

const WEB_EMAIL = 'flood-sung@xvirobotics.com';

/** POST /api/web/issue-token as a web identity (oauth2-proxy header). */
function issueWeb(port: number, email = WEB_EMAIL, extraBody?: string) {
  return rawRequest(
    port,
    'POST',
    '/api/web/issue-token',
    { 'X-Forwarded-Email': email, 'Content-Type': 'application/json' },
    extraBody ?? '{}',
  );
}

describe('self-service web token issuance — P4-MR1', () => {
  it('web-identity issues a usable member token', async () => {
    kit = await startTestServer('web-token-issue', { uiAllowedEmails: [WEB_EMAIL] });
    const res = await issueWeb(kit.port);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.botName).toBe(WEB_EMAIL);
    expect(typeof body.token).toBe('string');
    expect(body.token.startsWith('mt_')).toBe(true);
    expect(body.token.startsWith('mt_admin_')).toBe(false);
    expect(body.rotatedFrom).toBe(0);

    // The fresh token authenticates as a real Bearer member.
    const whoami = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', body.token);
    expect(whoami.status).toBe(200);
    expect(whoami.body.canonicalEmail).toBe(WEB_EMAIL);
    expect(whoami.body.role).toBe('member');
    expect(whoami.body.source).toBe('cli');
  });

  it('second call rotates: old token 401s, new token works', async () => {
    kit = await startTestServer('web-token-rotate', { uiAllowedEmails: [WEB_EMAIL] });
    const first = JSON.parse((await issueWeb(kit.port)).body);
    const firstOk = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', first.token);
    expect(firstOk.status).toBe(200);

    const second = await issueWeb(kit.port);
    expect(second.status).toBe(200);
    const secondBody = JSON.parse(second.body);
    expect(secondBody.token).not.toBe(first.token);
    expect(secondBody.rotatedFrom).toBe(1);

    // Old token is now revoked.
    const oldNow = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', first.token);
    expect(oldNow.status).toBe(401);
    expect(oldNow.body.error).toBe('credential_revoked');

    // New token works.
    const newOk = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', secondBody.token);
    expect(newOk.status).toBe(200);
  });

  it('admin Bearer is untouched by rotation (landmine #6)', async () => {
    kit = await startTestServer('web-token-admin-safe', { uiAllowedEmails: [WEB_EMAIL] });
    // Issue several self-service tokens, rotating each time.
    await issueWeb(kit.port);
    await issueWeb(kit.port);
    await issueWeb(kit.port);
    // The admin bootstrap token must still authenticate after all rotations.
    const adminCheck = await call(kit.baseUrl, 'GET', '/admin/credentials', kit.adminToken);
    expect(adminCheck.status).toBe(200);
    // And the admin cred was never revoked.
    const creds = adminCheck.body.credentials as Array<{
      role: string;
      revokedAt: number | null;
      notes: string;
    }>;
    const admin = creds.find((c) => c.role === 'admin');
    expect(admin).toBeDefined();
    expect(admin!.revokedAt).toBe(null);
    expect(admin!.notes).not.toContain('self-service');
  });

  it('Bearer caller is rejected (they already have a token)', async () => {
    kit = await startTestServer('web-token-bearer-reject', { uiAllowedEmails: [WEB_EMAIL] });
    // A real member Bearer hitting the self-service route → 4xx, no issue.
    const member = await call(kit.baseUrl, 'POST', '/admin/credentials/issue', kit.adminToken, {
      botName: 'cli-bot',
      ownerName: 'cli-owner',
      role: 'member',
    });
    expect(member.status).toBe(201);
    const memberToken = member.body.token as string;

    const res = await call(kit.baseUrl, 'POST', '/api/web/issue-token', memberToken, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bearer_already_authenticated');

    // Admin Bearer is likewise rejected — never issues, never rotates.
    const adminRes = await call(kit.baseUrl, 'POST', '/api/web/issue-token', kit.adminToken, {});
    expect(adminRes.status).toBe(400);
    expect(adminRes.body.error).toBe('bearer_already_authenticated');
  });

  it('body-supplied botName is ignored (anti-squat)', async () => {
    kit = await startTestServer('web-token-antisquat', { uiAllowedEmails: [WEB_EMAIL] });
    const res = await issueWeb(
      kit.port,
      WEB_EMAIL,
      JSON.stringify({ botName: 'attacker@evil.com', ownerName: 'attacker', role: 'admin' }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.botName).toBe(WEB_EMAIL);
    // Crafted role:'admin' must NOT have been honored.
    expect(body.token.startsWith('mt_admin_')).toBe(false);
    const whoami = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', body.token);
    expect(whoami.body.canonicalEmail).toBe(WEB_EMAIL);
    expect(whoami.body.role).toBe('member');
  });

  it('rotation revoke does NOT touch a non-self-service cred (landmine #6 regression)', async () => {
    kit = await startTestServer('web-token-scope', { uiAllowedEmails: [WEB_EMAIL] });
    // A CLI-issued member cred whose botName == the web email but with
    // DIFFERENT notes — must survive the web rotation revoke entirely.
    const cli = await call(kit.baseUrl, 'POST', '/admin/credentials/issue', kit.adminToken, {
      botName: WEB_EMAIL,
      ownerName: WEB_EMAIL,
      role: 'member',
      notes: 'hand-issued CLI token for flood',
    });
    expect(cli.status).toBe(201);
    const cliToken = cli.body.token as string;
    const cliCredId = cli.body.credential.id as string;

    // Two web rotations for the same email.
    await issueWeb(kit.port);
    const second = JSON.parse((await issueWeb(kit.port)).body);
    expect(second.rotatedFrom).toBe(1); // only the prior self-service one

    // The CLI cred (same botName, different notes) is untouched.
    const cliStillOk = await call(kit.baseUrl, 'GET', '/api/t5t/cli/whoami', cliToken);
    expect(cliStillOk.status).toBe(200);
    const list = await call(kit.baseUrl, 'GET', '/admin/credentials', kit.adminToken);
    const cliRow = (list.body.credentials as Array<{ id: string; revokedAt: number | null }>)
      .find((c) => c.id === cliCredId);
    expect(cliRow).toBeDefined();
    expect(cliRow!.revokedAt).toBe(null);
  });

  it('web-identity disabled (env unset) → route not reachable, falls to Bearer 401', async () => {
    kit = await startTestServer('web-token-off');
    const res = await issueWeb(kit.port);
    // No uiAllowedEmails → X-Forwarded-Email ignored → Bearer path → 401.
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toBe('missing_token');
  });
});
