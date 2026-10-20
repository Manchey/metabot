import { useState } from 'react';
import { api, ApiError, type TopFiveItem } from '../../lib/api';

interface TopFiveListProps {
  items: TopFiveItem[];
  project: string;
  onChanged: () => void;
}

const VISIBLE_OPEN = 5;

export function TopFiveList({ items, project, onChanged }: TopFiveListProps) {
  const [text, setText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const open = items.filter((i) => i.status === 'open');
  const done = items.filter((i) => i.status === 'done');
  const overflow = Math.max(0, open.length - VISIBLE_OPEN);
  const shownOpen = expanded ? open : open.slice(0, VISIBLE_OPEN);

  const handleError = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.status === 401) return;
    if (e instanceof ApiError && e.status === 403) {
      setErr('只有 owner 才能修改 Top-5');
      return;
    }
    setErr(e instanceof Error ? e.message : fallback);
  };

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed || busyId) return;
    setBusyId('__add');
    setErr(null);
    try {
      await api.postT5tTopFive({ project, text: trimmed });
      setText('');
      onChanged();
    } catch (e) {
      handleError(e, 'add failed');
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (item: TopFiveItem) => {
    if (busyId) return;
    setBusyId(item.itemId);
    setErr(null);
    try {
      await api.postT5tTopFive({
        project,
        itemId: item.itemId,
        status: item.status === 'done' ? 'open' : 'done',
      });
      onChanged();
    } catch (e) {
      handleError(e, 'update failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: TopFiveItem) => {
    if (busyId) return;
    if (!window.confirm(`Remove "${item.text}" from Top-5?`)) return;
    setBusyId(item.itemId);
    setErr(null);
    try {
      await api.postT5tTopFive({ project, itemId: item.itemId, status: 'removed' });
      onChanged();
    } catch (e) {
      handleError(e, 'remove failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="t5t-top5">
      <div className="head">
        <span className="label">Top 5</span>
        <span className="meta">
          {open.length} open · {done.length} done
        </span>
      </div>

      {open.length === 0 && done.length === 0 ? (
        <div className="t5t-top5-empty">尚无 Top-5 事项</div>
      ) : (
        <ul className="t5t-top5-list">
          {shownOpen.map((item) => (
            <li
              key={item.itemId}
              className={`t5t-top5-row${item.status === 'done' ? ' done' : ''}`}
            >
              <button
                type="button"
                className="t5t-top5-check"
                onClick={() => toggle(item)}
                disabled={busyId !== null}
                aria-label="mark done"
                title="mark done"
              >
                ☐
              </button>
              <span className="text">{item.text}</span>
              <span className="who">{item.author}</span>
              <button
                type="button"
                className="t5t-top5-remove"
                onClick={() => remove(item)}
                disabled={busyId !== null}
                aria-label="remove"
                title="remove"
              >
                ✕
              </button>
            </li>
          ))}
          {!expanded && overflow > 0 && (
            <li className="t5t-top5-overflow">
              <button type="button" onClick={() => setExpanded(true)}>
                + {overflow} more open
              </button>
            </li>
          )}
          {done.map((item) => (
            <li key={item.itemId} className="t5t-top5-row done">
              <button
                type="button"
                className="t5t-top5-check done"
                onClick={() => toggle(item)}
                disabled={busyId !== null}
                aria-label="reopen"
                title="reopen"
              >
                ☑
              </button>
              <span className="text">{item.text}</span>
              <span className="who">{item.author}</span>
              <button
                type="button"
                className="t5t-top5-remove"
                onClick={() => remove(item)}
                disabled={busyId !== null}
                aria-label="remove"
                title="remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="t5t-top5-add">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="add a Top-5 item…  (Enter)"
          spellCheck={false}
          disabled={busyId !== null}
        />
        <button
          type="button"
          onClick={add}
          disabled={!text.trim() || busyId !== null}
        >
          add
        </button>
      </div>

      {err && <div className="err">{err}</div>}
    </div>
  );
}
