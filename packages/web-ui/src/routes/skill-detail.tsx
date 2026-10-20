import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type SkillRecord } from '../lib/api';
import { renderMarkdown } from '../lib/render-markdown';
import { formatAbsolute } from '../lib/format';

export function SkillDetail() {
  const { name = '' } = useParams();
  const [skill, setSkill] = useState<SkillRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSkill(null);
    setErr(null);
    api.getSkill(name)
      .then((s) => { if (live) setSkill(s); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, [name]);

  return (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-section"><span>skill</span></div>
        <div style={{ padding: '0 18px' }}>
          <Link to="/skills" className="badge" style={{ display: 'inline-block' }}>← all skills</Link>
        </div>
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">skill</div>
            <h1>{name}</h1>
          </div>
          <span className="crumbs">
            <Link to="/skills">/ skills</Link>
            <span style={{ opacity: 0.4, margin: '0 6px' }}>›</span>
            {name}
          </span>
        </div>
        {err && <div className="state err">{err}</div>}
        {!err && !skill && <div className="state"><span className="cursor">loading</span></div>}
        {!err && skill && (
          <div className="skill-detail">
            <div
              className="md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(skill.skillMd || '') }}
            />
            <aside className="skill-side">
              <div className="row">
                <div className="key">version</div>
                <div className="val">v{skill.version}</div>
              </div>
              <div className="row">
                <div className="key">visibility</div>
                <div className="val">
                  <span className={`badge vis-${skill.visibility}`}>{skill.visibility}</span>
                </div>
              </div>
              <div className="row">
                <div className="key">author</div>
                <div className="val">{skill.author || '—'}</div>
              </div>
              <div className="row">
                <div className="key">owner bot</div>
                <div className="val">{skill.ownerBotName || '—'}</div>
              </div>
              <div className="row">
                <div className="key">description</div>
                <div className="val">{skill.description || '—'}</div>
              </div>
              <div className="row">
                <div className="key">tags</div>
                <div className="val">
                  {skill.tags.length === 0 ? '—' : skill.tags.map((t) => (
                    <span key={t} className="badge tag" style={{ marginRight: 4 }}>#{t}</span>
                  ))}
                </div>
              </div>
              <div className="row">
                <div className="key">user invocable</div>
                <div className="val">{skill.userInvocable ? 'yes' : 'no'}</div>
              </div>
              <div className="row">
                <div className="key">has refs</div>
                <div className="val">{skill.hasReferences ? 'yes' : 'no'}</div>
              </div>
              <div className="row">
                <div className="key">content sha</div>
                <div className="val" style={{ fontSize: 11 }}>{skill.contentHash.slice(0, 16)}…</div>
              </div>
              <div className="row">
                <div className="key">published</div>
                <div className="val" style={{ fontSize: 11 }}>{formatAbsolute(skill.publishedAt)}</div>
              </div>
              <div className="row">
                <div className="key">updated</div>
                <div className="val" style={{ fontSize: 11 }}>{formatAbsolute(skill.updatedAt)}</div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
