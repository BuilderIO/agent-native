/**
 * Overall uptime cards for the standard windows (24h / 7d / 30d / 90d),
 * UptimeRobot-style. Takes a pre-computed `UptimeWindows` object.
 *
 * Reusable by the authenticated monitor detail view and the public status page.
 */
import { cn } from "@/lib/utils";

import { formatUptimePct } from "./chart-utils";
import type { UptimeWindowKey, UptimeWindows } from "./types";

const DEFAULT_WINDOWS: { key: UptimeWindowKey; label: string }[] = [
  { key: "uptime24h", label: "24 hours" },
  { key: "uptime7d", label: "7 days" },
  { key: "uptime30d", label: "30 days" },
  { key: "uptime90d", label: "90 days" },
];

/** Color the percentage by health: >=99.9 green, >=95 amber, else red. */
function uptimeToneClass(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 99.9) return "text-emerald-500";
  if (pct >= 95) return "text-amber-500";
  return "text-red-500";
}

export interface UptimeStatCardsProps {
  windows: UptimeWindows;
  /** Override which windows/labels render, in order. */
  items?: { key: UptimeWindowKey; label: string }[];
  className?: string;
  cardClassName?: string;
  /** Compact spacing/type for dense in-app layouts. */
  compact?: boolean;
}

export function UptimeStatCards({
  windows,
  items = DEFAULT_WINDOWS,
  className,
  cardClassName,
  compact = false,
}: UptimeStatCardsProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 lg:grid-cols-4",
        compact && "gap-2",
        className,
      )}
    >
      {items.map(({ key, label }) => {
        const pct = windows[key];
        return (
          <div
            key={key}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border border-border/50 bg-card",
              compact ? "px-3 py-2" : "px-4 py-3",
              cardClassName,
            )}
          >
            <span
              className={cn(
                "uppercase tracking-wide text-muted-foreground",
                compact ? "text-[10px]" : "text-[11px]",
              )}
            >
              {label}
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                compact ? "text-lg" : "text-2xl",
                uptimeToneClass(pct),
              )}
            >
              {formatUptimePct(pct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
