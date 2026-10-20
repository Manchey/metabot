import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type AgentSummary } from '../lib/api';
import { formatAbsolute, formatRelative } from '../lib/format';

interface HostGroup {
  host: string;
  agents: AgentSummary[];
}

// Bucket agents by their server-derived `host` field. Bots with a missing or
// empty host (defensive — should never happen since the server always returns
// a string) drop into the literal "(unknown)" bucket so they remain visible.
function bucketByHost(agents: AgentSummary[]): HostGroup[] {
  const byHost = new Map<string, AgentSummary[]>();
  for (const a of agents) {
    const key = a.host || '(unknown)';
    const arr = byHost.get(key);
    if (arr) arr.push(a);
    else byHost.set(key, [a]);
  }
  const groups: HostGroup[] = [];
  for (const [host, list] of byHost) {
    list.sort((x, y) => x.botName.localeCompare(y.botName));
    groups.push({ host, agents: list });
  }
  groups.sort((a, b) => a.host.localeCompare(b.host));
  return groups;
}

export function AgentsList() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    let live = true;
    api.listAgents()
      .then(({ agents }) => { if (live) setAgents(agents); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => (agents ? bucketByHost(agents) : []), [agents]);

  const params = new URLSearchParams(loc.search);
  const wantedHost = params.get('h');
  const selectedGroup =
    (wantedHost && groups.find((g) => g.host === wantedHost)) ||
    groups[0] ||
    null;

  const totalAgents = agents?.length ?? 0;

  return (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-section">
          <span>hosts</span>
          <span className="count">{groups.length || (agents ? 0 : '—')}</span>
        </div>
        {err && <div className="sidebar-section">registry unavailable · {err}</div>}
        {!err && !agents && <div className="sidebar-section">loading…</div>}
        {!err && agents && groups.length > 0 && (
          <ul className="user-group-list">
            {groups.map((g) => {
              const active = g.host === selectedGroup?.host;
              return (
                <li
                  key={g.host}
                  className={'user-group-row' + (active ? ' active' : '')}
                  onClick={() => nav(`/agents?h=${encodeURIComponent(g.host)}`)}
                  role="button"
                >
                  <span className="chev">{active ? '›' : '·'}</span>
                  <span className="name">{g.host}</span>
                  <span className="count">{g.agents.length}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ padding: '0 18px', marginTop: 12, color: 'var(--bone-300)', fontSize: 11, lineHeight: 1.6 }}>
          registered bot agents reachable via the talk-bus. grouped by host —
          read-only. register, rotate visibility, or talk to an agent via the{' '}
          <code style={{ color: 'var(--amber)' }}>metabot</code> CLI.
        </div>
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">registry · by host</div>
            <h1>{selectedGroup?.host ?? 'agents'}</h1>
          </div>
          <span className="crumbs">/ agents{selectedGroup ? ` / ${selectedGroup.host}` : ''}</span>
        </div>
        {err && <div className="state err">{err}</div>}
        {!err && !agents && <div className="state"><span className="cursor">loading</span></div>}
        {!err && agents && totalAgents === 0 && (
          <div className="state">no agents registered · run <code>metabot agents register</code> from a bot host</div>
        )}
        {!err && agents && totalAgents > 0 && selectedGroup && (
          <table className="agents-table">
            <thead>
              <tr>
                <th className="idx">#</th>
                <th>name</th>
                <th>url</th>
                <th>last seen</th>
                <th>visibility</th>
                <th>chat</th>
              </tr>
            </thead>
            <tbody>
              {selectedGroup.agents.map((a, i) => (
                <tr key={a.botName}>
                  <td className="idx">{String(i + 1).padStart(3, '0')}</td>
                  <td className="name">{a.botName}</td>
                  <td className="url"><code>{a.url}</code></td>
                  <td className="ts" title={formatAbsolute(a.lastSeenAt)}>{formatRelative(a.lastSeenAt)}</td>
                  <td>
                    <span className={`badge ${a.visible ? 'vis-published' : 'vis-private'}`}>
                      {a.visible ? 'visible' : 'hidden'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="agent-chat-button"
                      onClick={() => nav(`/chat?agent=${encodeURIComponent(a.botName)}`)}
                    >
                      chat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
