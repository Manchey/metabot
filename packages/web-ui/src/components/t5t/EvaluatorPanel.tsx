import type { Evaluator } from '../../lib/api';

interface EvaluatorPanelProps {
  evaluators: Evaluator[] | null | undefined;
  slug: string;
}

// Read-only by design: the check is a visual <span>, never an <input>.
// All mutations happen via the metabot t5t CLI.
export function EvaluatorPanel({ evaluators, slug }: EvaluatorPanelProps) {
  if (!evaluators || evaluators.length === 0) {
    return (
      <div className="t5t-card muted">
        评估器未定义 —{' '}
        <code>metabot t5t evaluator --project {slug} --id &lt;kebab&gt; "&lt;desc&gt;"</code>
      </div>
    );
  }
  return (
    <div className="t5t-card">
      <div className="kicker">evaluators</div>
      <ul className="t5t-evals">
        {evaluators.map((e) => (
          <li key={e.evaluatorId}>
            <span
              className={`t5t-check${e.met ? ' met' : ''}`}
              aria-label={e.met ? 'met' : 'unmet'}
            >
              {e.met ? '✓' : '✗'}
            </span>
            <div>
              <div className="desc">{e.description}</div>
              <div className="eid">{e.evaluatorId}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
