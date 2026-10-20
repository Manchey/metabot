import type { ProjectStatus } from '../../lib/api';

const LABEL: Record<ProjectStatus, string> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  killed: 'killed',
  unknown: 'unknown',
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  return <span className={`t5t-pill ${status}`}>{LABEL[status]}</span>;
}
