import type { Bottleneck } from '../../lib/api';

interface BottleneckCalloutProps {
  bottleneck: Bottleneck | null | undefined;
}

function ageLabel(iso: string): string {
  const created = Date.parse(iso);
  if (Number.isNaN(created)) return '';
  const days = Math.floor((Date.now() - created) / 86_400_000);
  return days < 1 ? '今天' : `${days} 天前`;
}

export function BottleneckCallout({ bottleneck }: BottleneckCalloutProps) {
  // A cleared bottleneck counts as "none" per the t5t contract.
  if (!bottleneck || bottleneck.cleared) {
    return <div className="t5t-card muted">无当前 bottleneck</div>;
  }
  return (
    <div className="t5t-bottleneck">
      <div className="head">
        <span className="label">Bottleneck</span>
        <span className="age">{ageLabel(bottleneck.createdAt)}</span>
      </div>
      <p>{bottleneck.text}</p>
    </div>
  );
}
