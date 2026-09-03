/**
 * A strip of colored uptime buckets over a window (UptimeRobot-style), one bar
 * per pre-bucketed period: green up / red down / amber degraded / muted
 * no-data. Each bar has a tooltip with its time range, uptime %, and downtime.
 *
 * Reusable by the authenticated monitor detail view and the public status page.
 * It takes ALREADY-bucketed data (`buckets`) — it does no fetching or
 * aggregation itself.
 */
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  bucketFillClass,
  bucketStatusLabel,
  formatRange,
  formatUptimePct,
} from "./chart-utils";
import type { UptimeBucket } from "./types";

export interface UptimeTimelineBarsProps {
  buckets: UptimeBucket[];
  /** Tailwind height for the strip. Default `h-8`. */
  heightClassName?: string;
  /** Rounded corners on each bar. Default `rounded-sm`. */
  barRadiusClassName?: string;
  className?: string;
  /** Accessible label describing the timeline. */
  ariaLabel?: string;
  /** Render nothing (instead of an empty strip) when there are no buckets. */
  hideWhenEmpty?: boolean;
}

export function UptimeTimelineBars({
  buckets,
  heightClassName = "h-8",
  barRadiusClassName = "rounded-sm",
  className,
  ariaLabel = "Uptime timeline",
  hideWhenEmpty = false,
}: UptimeTimelineBarsProps) {
  if (buckets.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border/60 text-xs text-muted-foreground",
          heightClassName,
          className,
        )}
      >
        No data yet{/* i18n-ignore public status page fixed copy */}
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-stretch gap-0.5", heightClassName, className)}
      role="img"
      aria-label={ariaLabel}
    >
      {buckets.map((bucket, index) => (
        <Tooltip key={`${bucket.start}-${index}`}>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "min-w-0 flex-1 opacity-90 transition-opacity hover:opacity-100",
                barRadiusClassName,
                bucketFillClass(bucket.status),
              )}
              data-status={bucket.status}
            />
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            <div className="font-medium">
              {bucketStatusLabel(bucket.status)}
            </div>
            <div className="text-muted-foreground">
              {formatRange(bucket.start, bucket.end)}
            </div>
            {bucket.total > 0 ? (
              <div className="text-muted-foreground">
                {formatUptimePct(bucket.uptimePct)} uptime · {bucket.total}{" "}
                {bucket.total === 1 ? "check" : "checks"}
                {bucket.downCount > 0 ? ` · ${bucket.downCount} down` : ""}
                {bucket.degradedCount > 0
                  ? ` · ${bucket.degradedCount} degraded`
                  : ""}
              </div>
            ) : (
              <div className="text-muted-foreground">
                No checks recorded
                {/* i18n-ignore public status page fixed copy */}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
