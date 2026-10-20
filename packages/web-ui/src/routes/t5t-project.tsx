import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type ProjectDetailResponse } from '../lib/api';
import { formatRelative } from '../lib/format';
import { StatusPill } from '../components/t5t/StatusPill';
import { GoalBanner } from '../components/t5t/GoalBanner';
import { EvaluatorPanel } from '../components/t5t/EvaluatorPanel';
import { BottleneckCallout } from '../components/t5t/BottleneckCallout';
import { TopFiveList } from '../components/t5t/TopFiveList';
import { VerticalWIPBoard } from '../components/t5t/VerticalWIPBoard';
import { T5TTimeline } from '../components/t5t/T5TTimeline';
import { FeedbackThread } from '../components/t5t/FeedbackThread';

export function T5tProject() {
  const { slug = '' } = useParams();
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);

  const load = useCallback((live: () => boolean) => {
    api.getT5tProject(slug)
      .then((d) => { if (live()) setDetail(d); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (e instanceof ApiError && e.status === 404) {
          if (live()) setErr(`project_not_found · ${slug}`);
          return;
        }
        if (live()) setErr(e instanceof Error ? e.message : 'failed');
      });
  }, [slug]);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(null);
    load(() => alive);
    return () => { alive = false; };
  }, [load]);

  const refresh = useCallback(() => {
    load(() => true);
  }, [load]);

  const onKill = useCallback(async () => {
    if (!detail) return;
    const projectName = detail.project.name || detail.project.slug;
    if (!window.confirm(`Kill project "${projectName}"? Status will be set to killed (append-only; old docs preserved).`)) {
      return;
    }
    setKilling(true);
    try {
      await api.killT5tProject(detail.project.slug);
      refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      window.alert(e instanceof Error ? e.message : 'kill failed');
    } finally {
      setKilling(false);
    }
  }, [detail, refresh]);

  return (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-section">
          <span>project</span>
          <span className="count">{detail?.entries.length ?? '—'}</span>
        </div>
        <div style={{ padding: '0 18px' }}>
          <Link to="/t5t" style={{ fontSize: 12 }}>‹ back to board</Link>
        </div>
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">project</div>
            <h1>{detail?.project.name || slug}</h1>
          </div>
          <span className="crumbs">
            <Link to="/t5t">/ t5t</Link> ›{' '}
            {detail ? detail.project.slug : slug}
          </span>
        </div>

        {err && <div className="state err">{err}</div>}
        {!err && !detail && (
          <div className="state"><span className="cursor">loading</span></div>
        )}

        {!err && detail && (
          <div className="t5t-grid">
            <div
              className="doc-meta"
              style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}
            >
              <StatusPill status={detail.project.status} />
              <span>
                负责人 ·{' '}
                <strong>{detail.project.leaderEmail || '无 owner'}</strong>
              </span>
              <span>
                最后活动 ·{' '}
                {detail.project.lastPush
                  ? formatRelative(detail.project.lastPush)
                  : '—'}
              </span>
              {detail.project.killCriteria && (
                <span>kill · {detail.project.killCriteria}</span>
              )}
              {detail.project.status !== 'killed' && (
                <button
                  type="button"
                  onClick={onKill}
                  disabled={killing}
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    background: 'transparent',
                    color: 'var(--bone-300)',
                    border: '1px solid var(--bone-700, #444)',
                    borderRadius: 3,
                    padding: '3px 10px',
                    cursor: killing ? 'wait' : 'pointer',
                  }}
                >
                  {killing ? 'killing…' : 'kill project'}
                </button>
              )}
            </div>

            <GoalBanner goal={detail.project.goal} slug={detail.project.slug} />
            <BottleneckCallout bottleneck={detail.project.bottleneck} />
            <TopFiveList
              items={detail.topFive}
              project={detail.project.slug}
              onChanged={refresh}
            />

            <div className="t5t-cols">
              <div className="t5t-grid">
                <VerticalWIPBoard
                  columns={detail.wipBoard}
                  slug={detail.project.slug}
                />
                <div className="section">
                  <h2>
                    timeline{' '}
                    <span className="count">{detail.entries.length}</span>
                  </h2>
                  <T5TTimeline entries={detail.entries} />
                </div>
              </div>
              <div className="t5t-grid">
                <EvaluatorPanel
                  evaluators={detail.project.evaluators}
                  slug={detail.project.slug}
                />
                <FeedbackThread
                  feedback={detail.feedback}
                  entries={detail.entries}
                  onPosted={refresh}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
