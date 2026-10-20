import type { CredentialsStore } from '../auth/credentials-store.js';
import type { Credential } from '../auth/credentials.js';
import type { AgentStore } from '../agents/agent-store.js';

export interface RouteResult {
  status: number;
  body: unknown;
}

function err(status: number, error: string): RouteResult {
  return { status, body: { error } };
}

/**
 * Stable per-identity marker for self-service web-issued tokens. The email is
 * baked in so the rotation revoke can scope to EXACTLY this caller's prior
 * self-service token and never an admin- or CLI-issued credential (the
 * marker is matched by `findActiveByNotes` with full string equality).
 */
export function selfServiceNotes(email: string): string {
  return `self-service web token for ${email}`;
}

/**
 * POST /api/web/issue-token — self-service onboarding.
 *
 * Web-identity ONLY. A Bearer caller already holds a token; issuing them a
 * second one would silently fork their identity, so they are rejected.
 *
 * Identity is server-derived from the authenticated web credential
 * (`cred.botName` = the oauth2-proxy `X-Forwarded-Email`); any `botName` in
 * the request body is ignored (anti-squat, mirrors the `/api/agents` rule).
 *
 * Rotation, not accumulation: the caller's existing non-revoked self-service
 * credential (matched by the exact per-email marker) is revoked before a
 * fresh member token is issued. The plaintext token is returned ONCE.
 */
export function issueWebToken(
  store: CredentialsStore,
  cred: Credential,
): RouteResult {
  if (cred.authSource !== 'web') {
    // A Bearer principal reached here — they already have a credential.
    return err(400, 'bearer_already_authenticated');
  }

  const email = (cred.botName || '').trim().toLowerCase();
  if (!email) return err(400, 'identity_unresolved');

  const marker = selfServiceNotes(email);

  // Rotation: revoke only THIS caller's prior self-service token(s). Exact
  // marker match (see findActiveByNotes) — never admin/CLI creds.
  let revokedCount = 0;
  for (const prior of store.findActiveByNotes(marker)) {
    if (store.revoke(prior.id) !== null) revokedCount += 1;
  }

  const { credential, token } = store.issue({
    botName: email,
    ownerName: email,
    role: 'member',
    notes: marker,
  });

  return {
    status: 200,
    body: {
      token,
      botName: credential.botName,
      credentialId: credential.id,
      rotatedFrom: revokedCount,
    },
  };
}

/**
 * GET /api/whoami — token verification + identity introspection.
 *
 * The bridge calls this with the caller's `METABOT_CORE_TOKEN` to verify a
 * cross-bridge `/api/talk` request: if 200, the token is valid; the response
 * also surfaces the caller's botName/role/authSource for caller-stamping.
 * The CLI surfaces the same data through `metabot agents whoami`.
 *
 * Open to both Bearer and web-identity (it does nothing beyond echoing
 * already-authenticated metadata — no DB writes, no token issuance).
 *
 * Also returns `memoryPublic` (when the caller is a member bot with an
 * agent-registry row): the metamemory CLI consumes it to decide whether
 * default writes auto-prefix into `/shared/<botName>/` or `/users/<botName>/`.
 * Returns `false` when no agent row exists (bots that haven't bulk-registered
 * yet, or admins) — that's the safe private default.
 */
export function getWhoami(cred: Credential, agentStore?: AgentStore): RouteResult {
  let memoryPublic = false;
  if (agentStore && cred.role !== 'admin') {
    const rec = agentStore.getByName(cred.botName);
    if (rec) memoryPublic = rec.memoryPublic;
  }
  return {
    status: 200,
    body: {
      botName: cred.botName,
      ownerName: cred.ownerName,
      role: cred.role,
      authSource: cred.authSource ?? 'bearer',
      credentialId: cred.id,
      memoryPublic,
    },
  };
}
