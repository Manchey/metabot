import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type SkillSummary } from '../lib/api';
import { formatRelative } from '../lib/format';

export function SkillsList() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.listSkills()
      .then(({ skills }) => { if (live) setSkills(skills); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, []);

  return (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-section">
          <span>skills</span>
          <span className="count">{skills?.length ?? '—'}</span>
        </div>
        <div style={{ padding: '0 18px', color: 'var(--bone-300)', fontSize: 11, lineHeight: 1.6 }}>
          published skills available to install via <code style={{ color: 'var(--amber)' }}>mh install &lt;name&gt;</code>.
        </div>
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">registry</div>
            <h1>skill hub</h1>
          </div>
          <span className="crumbs">/ skills</span>
        </div>
        {err && <div className="state err">{err}</div>}
        {!err && !skills && <div className="state"><span className="cursor">loading</span></div>}
        {!err && skills && skills.length === 0 && (
          <div className="state">no skills published yet</div>
        )}
        {!err && skills && skills.map((s, i) => (
          <Link key={s.id} to={`/skills/${encodeURIComponent(s.name)}`} className="doc-row">
            <span className="idx">{String(i + 1).padStart(3, '0')}</span>
            <span className="title">
              <span className={`badge vis-${s.visibility}`}>{s.visibility}</span>
              {s.name}
              <span className="path">v{s.version} · {s.description?.slice(0, 80) || ''}</span>
            </span>
            <span className="tags">
              {s.tags.slice(0, 3).map((t) => (
                <span className="badge tag" key={t}>#{t}</span>
              ))}
            </span>
            <span className="ts" title={s.updatedAt}>{formatRelative(s.updatedAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
