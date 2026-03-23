import type { JiraAnalytics } from "./hooks";

interface Props {
  analytics: JiraAnalytics | undefined;
  isLoading: boolean;
}

export function JiraOverviewCards({ analytics, isLoading }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Open Issues"
        value={analytics?.totalOpen}
        loading={isLoading}
      />
      <StatCard
        label="Created (Period)"
        value={analytics?.createdInPeriod}
        loading={isLoading}
      />
      <StatCard
        label="Resolved (Period)"
        value={analytics?.resolvedInPeriod}
        loading={isLoading}
        variant={
          analytics && analytics.resolvedInPeriod >= analytics.createdInPeriod
            ? "success"
            : "default"
        }
      />
      <StatCard
        label="Net Change"
        value={
          analytics &&
          !isNaN(analytics.createdInPeriod) &&
          !isNaN(analytics.resolvedInPeriod)
            ? analytics.createdInPeriod - analytics.resolvedInPeriod
            : undefined
        }
        loading={isLoading}
        variant={
          analytics && analytics.createdInPeriod > analytics.resolvedInPeriod
            ? "danger"
            : "success"
        }
        prefix={
          analytics &&
          analytics.createdInPeriod - analytics.resolvedInPeriod > 0
            ? "+"
            : ""
        }
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  variant = "default",
  prefix = "",
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  variant?: "default" | "danger" | "success";
  prefix?: string;
}) {
  const colorClass =
    variant === "danger"
      ? "text-red-400"
      : variant === "success"
        ? "text-green-400"
        : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {loading || value === undefined ? (
        <div className="text-lg font-bold text-muted-foreground animate-pulse">
          ...
        </div>
      ) : (
        <div className={`text-2xl font-bold ${colorClass}`}>
          {prefix}
          {formatNumber(value)}
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
