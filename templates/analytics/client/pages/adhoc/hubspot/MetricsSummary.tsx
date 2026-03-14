import { cn } from "@/lib/utils";
import type { HubSpotMetrics } from "@/lib/api-hooks";
import { Skeleton } from "@/components/ui/skeleton";

function fmt(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

function fmtDollars(val: number): string {
  return `$${fmt(Math.round(val))}`;
}

function fmtPercent(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

interface Props {
  metrics: HubSpotMetrics | undefined;
  isLoading: boolean;
}

export function MetricsSummary({ metrics, isLoading }: Props) {
  if (isLoading || !metrics) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-lg" />
        ))}
      </div>
    );
  }

  const cards = [
    { label: "Open Deals", value: fmt(metrics.openDeals), color: "" },
    {
      label: "Open Pipeline",
      value: fmtDollars(metrics.openPipelineValue),
      color: "text-blue-400",
    },
    {
      label: "Won Revenue",
      value: fmtDollars(metrics.wonValue),
      color: "text-emerald-400",
    },
    {
      label: "Win Rate",
      value: fmtPercent(metrics.winRate),
      color: "text-yellow-400",
    },
    {
      label: "Avg ACV",
      value: fmtDollars(metrics.avgDealSize),
      color: "text-blue-400",
    },
    {
      label: "Landing ACV",
      value: fmtDollars(metrics.landingAcv),
      color: "text-cyan-400",
    },
    {
      label: "POV Success",
      value: fmtPercent(metrics.povSuccessRate),
      color: "text-purple-400",
      subtitle: `${metrics.povWon}/${metrics.povEntered}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-border/50 bg-card p-2.5 text-center"
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {c.label}
          </p>
          <p className={cn("text-lg font-semibold tabular-nums", c.color)}>
            {c.value}
          </p>
          {"subtitle" in c && c.subtitle && (
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {c.subtitle}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
