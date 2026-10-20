import { cn } from "@/lib/utils";

import { useItemsStrings } from "../items-strings";
import { formatDuration, formatPercent } from "../items/format";
import type { NodeAudit, StepStatus } from "../items/read-types";
import { segmentsLabel, statusSegments } from "./audit-model";

const SEGMENT_STYLES: Record<StepStatus, string> = {
  succeeded: "bg-muted-foreground/50",
  skipped: "bg-border",
  running: "bg-foreground/30",
  needs_check: "bg-destructive/60",
  failed: "bg-destructive",
};

/** Runs of this node as one bar and a line of numbers; a step that never ran says so. */
export function AuditSummary({
  summary,
  hasMoreSteps,
}: {
  summary: NodeAudit["summary"];
  hasMoreSteps: boolean;
}) {
  const s = useItemsStrings();

  if (summary.steps === 0) {
    return <p className="text-sm text-muted-foreground">{s.audit.neverRan}</p>;
  }
  const segments = statusSegments(summary.statusCounts);
  const { live, dry, test } = summary.modeCounts;
  const failed = summary.statusCounts.failed + summary.statusCounts.needs_check;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{s.audit.runsCount(summary.steps)}</span>
        <span
          className={cn(
            "tabular-nums",
            failed > 0
              ? "font-medium text-destructive"
              : "text-muted-foreground",
          )}
        >
          {summary.failureRate !== null && summary.failureRate > 0
            ? s.audit.failureRate(formatPercent(summary.failureRate))
            : s.audit.noFailures}
        </span>
      </div>
      <div
        role="img"
        aria-label={segmentsLabel(segments, s)}
        className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {segments.map((segment) => (
          <span
            key={segment.status}
            className={SEGMENT_STYLES[segment.status]}
            // A lone failure among hundreds stays visible: no segment draws under 2%.
            style={{ width: `${Math.max(segment.fraction * 100, 2)}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {segments.map((segment) => (
          <li key={segment.status} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                SEGMENT_STYLES[segment.status],
              )}
              aria-hidden
            />
            <span className="tabular-nums">
              {segment.count} {s.audit.stepStatus[segment.status]}
            </span>
          </li>
        ))}
      </ul>
      {summary.durationMs ? (
        <p className="text-xs text-muted-foreground">
          {s.audit.duration(
            formatDuration(summary.durationMs.p50, s),
            formatDuration(summary.durationMs.p95, s),
          )}
        </p>
      ) : null}
      {dry > 0 || test > 0 ? (
        <p className="text-xs text-muted-foreground">
          {s.audit.modes(live, dry, test)}
        </p>
      ) : null}
      {hasMoreSteps ? (
        <p className="text-xs text-muted-foreground">{s.audit.moreRuns}</p>
      ) : null}
    </div>
  );
}
