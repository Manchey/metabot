export const API_TOKEN_STORAGE_KEY = 'metabot-core:api-token';
export const AUTH_REQUIRED_EVENT = 'metabot-core:auth-required';

export function getApiToken(): string {
  try {
    return localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function setApiToken(token: string): void {
  const normalized = token.trim();
  if (!normalized) throw new Error('token_required');
  localStorage.setItem(API_TOKEN_STORAGE_KEY, normalized);
}

export function clearApiToken(notify = false): void {
  try {
    localStorage.removeItem(API_TOKEN_STORAGE_KEY);
  } catch {
    // An unavailable storage backend should not block sign-out.
  }
  if (notify && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
}
