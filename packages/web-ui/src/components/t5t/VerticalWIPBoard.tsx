import { useMemo } from 'react';
import type { WIPBoardColumn, WIPItem, WipStatus } from '../../lib/api';

interface VerticalWIPBoardProps {
  columns: WIPBoardColumn[] | null | undefined;
  slug: string;
}

const STATUS_LABEL: Record<WipStatus, string> = {
  doing: 'DOING',
  queued: 'QUEUE',
  done: 'DONE',
};

const ORDER: Record<WipStatus, number> = { doing: 0, queued: 1, done: 2 };

function sortItems(items: WIPItem[]): WIPItem[] {
  return [...items].sort((a, b) => {
    const d = ORDER[a.status] - ORDER[b.status];
    if (d !== 0) return d;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

function countBy(items: WIPItem[], status: WipStatus): number {
  return items.filter((i) => i.status === status).length;
}

function WIPCard({ item }: { item: WIPItem }) {
  return (
    <div className={`t5t-wip-card ${item.status}`}>
      <div className="meta">
        <span>{STATUS_LABEL[item.status]}</span>
        <span>{item.wipId}</span>
      </div>
      <div className="body">{item.description}</div>
      <div className="who">@{item.author}</div>
    </div>
  );
}

function Column({ col }: { col: WIPBoardColumn }) {
  const items = useMemo(() => sortItems(col.items), [col.items]);
  const doing = countBy(col.items, 'doing');
  const queued = countBy(col.items, 'queued');
  const done = countBy(col.items, 'done');
  return (
    <div className="t5t-wip-col">
      <div className="col-head">
        <span
          className={`t5t-check${col.evaluator.met ? ' met' : ''}`}
          aria-label={col.evaluator.met ? 'met' : 'unmet'}
        >
          {col.evaluator.met ? '✓' : '✗'}
        </span>
        <h3>{col.evaluator.description}</h3>
      </div>
      <div className="tally">
        doing {doing} · queued {queued} · done {done}
      </div>
      {items.length === 0 ? (
        <div className="tally" style={{ marginTop: 12 }}>无 WIP</div>
      ) : (
        <ul className="t5t-wip-cards">
          {items.map((it) => (
            <li key={it.docId || it.wipId}>
              <WIPCard item={it} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VerticalWIPBoard({ columns, slug }: VerticalWIPBoardProps) {
  if (!columns || columns.length === 0) {
    return (
      <div className="t5t-card muted">
        评估器未定义 —{' '}
        <code>metabot t5t evaluator --project {slug} --id &lt;kebab&gt; "&lt;desc&gt;"</code>
      </div>
    );
  }
  return (
    <div>
      <div className="t5t-wip-head">
        <div className="kicker">wip board · {columns.length}</div>
        <span className="hint">
          只读 · 用 <code>metabot t5t wip</code> 更新
        </span>
      </div>
      <div className="t5t-wip-cols">
        {columns.map((col) => (
          <Column key={col.evaluator.evaluatorId} col={col} />
        ))}
      </div>
    </div>
  );
}
