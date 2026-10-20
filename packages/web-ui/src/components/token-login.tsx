import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { clearApiToken, setApiToken } from '../lib/auth';

export function TokenLogin({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = token.trim();
    if (!normalized) {
      setError('API token is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setApiToken(normalized);
      await api.whoami();
      setToken('');
      onAuthenticated();
    } catch (err) {
      clearApiToken();
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid or expired API token'
          : err instanceof Error
            ? err.message
            : 'Login failed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="stripe" />
        <div className="sub">personal edition</div>
        <h1>MetaBot Core</h1>
        <p className="hint">Sign in with the local Bearer token created by your self-hosted MetaBot Core.</p>
        <label htmlFor="metabot-api-token">API token</label>
        <textarea
          id="metabot-api-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste ~/.metabot-core/token or admin-bootstrap-token.txt"
          autoComplete="off"
          autoFocus
          spellCheck={false}
        />
        {error && <div className="err">{error}</div>}
        <div className="submit-row">
          <span className="hint">Stored only in this browser.</span>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'checking…' : 'sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
