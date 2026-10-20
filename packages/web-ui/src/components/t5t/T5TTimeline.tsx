import { useMemo } from 'react';
import type { T5TEntry } from '../../lib/api';

// metabot-core entries carry only `retracts` (the entryId this one supersedes).
// There is no inverse `retracted_by`, so derive the retracted set: an entry is
// retracted iff some other entry's `retracts` points at its entryId.
export function T5TTimeline({ entries }: { entries: T5TEntry[] }) {
  const retractedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.retracts) map.set(e.retracts, e.entryId);
    }
    return map;
  }, [entries]);

  if (entries.length === 0) {
    return <div className="t5t-card muted">尚无 T5T 记录</div>;
  }
  return (
    <ol className="t5t-timeline">
      {entries.map((e) => {
        const supersededBy = retractedBy.get(e.entryId);
        const retracted = Boolean(supersededBy);
        return (
          <li
            key={e.docId || e.entryId}
            className={`t5t-entry${retracted ? ' done' : ''}`}
            style={retracted ? { opacity: 0.6 } : undefined}
            aria-label={`T5T ${e.date} ${e.author}`}
          >
            <div className="head">
              <span className="who">
                <span className="date">{e.date}</span>
                {e.author}
              </span>
              {retracted && (
                <span className="t5t-pill killed">已撤回 → {supersededBy}</span>
              )}
              {e.retracts && (
                <span className="t5t-pill yellow">撤回 ← {e.retracts}</span>
              )}
            </div>
            <ol>
              {e.items.map((it, i) => (
                <li key={i}>
                  <span className="n">{i + 1}.</span>
                  <span style={retracted ? { textDecoration: 'line-through' } : undefined}>
                    {it}
                  </span>
                </li>
              ))}
            </ol>
            <div className="docid">{e.entryId}</div>
          </li>
        );
      })}
    </ol>
  );
}
