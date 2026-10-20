import { useState } from 'react';
import { api, ApiError, type FeedbackEntry, type T5TEntry } from '../../lib/api';
import { formatAbsolute } from '../../lib/format';

function highlightMentions(text: string) {
  return text.split(/(@[\w.-]+)/g).map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="mention">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

interface FeedbackThreadProps {
  feedback: FeedbackEntry[];
  entries: T5TEntry[];
  onPosted: () => void;
}

export function FeedbackThread({ feedback, entries, onPosted }: FeedbackThreadProps) {
  const [target, setTarget] = useState(entries[0]?.entryId ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = text.trim();
  const canPost = Boolean(target) && trimmed.length > 0 && !busy;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    setErr(null);
    try {
      const mentions = Array.from(
        new Set((trimmed.match(/@[\w.-]+/g) ?? []).map((m) => m.slice(1))),
      );
      await api.postT5tFeedback({ onEntry: target, comment: trimmed, mentions });
      setText('');
      onPosted();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section">
      <h2>
        feedback <span className="count">{feedback.length}</span>
      </h2>

      {feedback.length === 0 ? (
        <div className="t5t-card muted">尚无反馈</div>
      ) : (
        <ol className="t5t-fb">
          {feedback.map((f) => (
            <li key={f.docId || f.feedbackId}>
              <div className="head">
                <span>
                  <strong>{f.from}</strong> on <span className="on">{f.onEntry}</span>
                </span>
                <span>{formatAbsolute(f.createdAt)}</span>
              </div>
              <div className="body">{highlightMentions(f.comment)}</div>
            </li>
          ))}
        </ol>
      )}

      {entries.length === 0 ? (
        <div className="t5t-card muted">无可回复的条目</div>
      ) : (
        <div className="t5t-composer">
          <div className="kicker">add feedback</div>
          <label htmlFor="fb-target">回复条目</label>
          <select
            id="fb-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {entries.map((e) => (
              <option key={e.entryId} value={e.entryId}>
                {e.date} · {e.author} · {e.entryId}
              </option>
            ))}
          </select>
          <label htmlFor="fb-text">评论（支持 @用户名 mention）</label>
          <textarea
            id="fb-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="评论…"
            rows={4}
            spellCheck={false}
          />
          <div className="row">
            {err ? <span className="err">提交失败：{err}</span> : <span />}
            <button className="btn" disabled={!canPost} onClick={submit}>
              {busy ? '提交中…' : '发送'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
