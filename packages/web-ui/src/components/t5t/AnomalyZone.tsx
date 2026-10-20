import { Link } from 'react-router-dom';
import type { AnomalyItem } from '../../lib/api';
import { formatRelative } from '../../lib/format';

export function AnomalyZone({ items }: { items: AnomalyItem[] }) {
  return (
    <div className="section">
      <h2>
        anomalies <span className="count">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <div className="t5t-card muted">无异常项</div>
      ) : (
        <div className="t5t-anomalies">
          {items.map((a) => (
            <Link
              key={`${a.project}:${a.reason}`}
              to={`/t5t/${encodeURIComponent(a.project)}`}
              className="t5t-anomaly"
            >
              <div className="head">
                <span className="name">{a.project}</span>
                <span className="reason">{a.reason.replace(/_/g, ' ')}</span>
              </div>
              <div className="detail">{a.detail}</div>
              {a.lastPush && (
                <div className="last">最后活动 {formatRelative(a.lastPush)}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
