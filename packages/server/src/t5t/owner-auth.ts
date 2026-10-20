import type { Credential } from '../auth/credentials.js';
import type { ProjectSummary } from './types.js';

export interface AuthFailure {
  status: number;
  error: string;
}

/**
 * Owner-auth gate for T5T project writes. Returns `null` when the caller is
 * allowed; otherwise returns an `AuthFailure` to render straight into the
 * HTTP response. Mirrors t5t-portal contract §2.5:
 *
 *   - Admin role is always allowed (operator override).
 *   - Project leader (case-insensitive email match against `leaderEmail`) is
 *     allowed.
 *   - Anyone listed in `allowedUsers` (case-insensitive) is allowed.
 *   - Deny-by-default: a project with BOTH `leaderEmail` unset AND
 *     `allowedUsers` empty rejects ALL writes — even from the project's
 *     original author. This is intentional: an unclaimed project is read-only
 *     until someone sets ownership.
 */
export function requireOwner(
  project: Pick<ProjectSummary, 'leaderEmail' | 'allowedUsers'>,
  cred: Credential,
): AuthFailure | null {
  if (cred.role === 'admin') return null;

  const leaderEmail = (project.leaderEmail || '').trim().toLowerCase();
  const allowedUsers = (project.allowedUsers || [])
    .map((u) => (u || '').trim().toLowerCase())
    .filter(Boolean);

  if (!leaderEmail && allowedUsers.length === 0) {
    return { status: 403, error: 'owner_required' };
  }

  const callerName = (cred.botName || '').trim().toLowerCase();
  if (!callerName) return { status: 403, error: 'owner_required' };

  if (leaderEmail && callerName === leaderEmail) return null;
  if (allowedUsers.includes(callerName)) return null;

  return { status: 403, error: 'owner_required' };
}
