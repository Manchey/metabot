interface GoalBannerProps {
  goal: string | null | undefined;
  slug: string;
}

export function GoalBanner({ goal, slug }: GoalBannerProps) {
  if (!goal) {
    return (
      <div className="t5t-card muted">
        未声明 goal — <code>metabot t5t goal --project {slug} "&lt;text&gt;"</code>
      </div>
    );
  }
  return (
    <div className="t5t-card t5t-goal">
      <div className="label">Goal</div>
      <p>{goal}</p>
    </div>
  );
}
