/**
 * Monitor list: a "current status" overview summary on top, then one row per
 * monitor with status, a compact colorful 90-day uptime bar, latency, uptime,
 * last-checked, an enable/disable switch, and a run-now action. Rows select into
 * the detail view. Includes loading + empty states.
 */
import {
  IconChevronRight,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconWorldPin,
} from "@tabler/icons-react";

import { UptimeTimelineBars } from "@/components/monitoring";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { fmt, useUptimeT } from "./i18n";
import {
  summarizeMonitors,
  type MonitorHealthTone,
  type MonitorStatusSummary,
} from "./status-summary";
import type { MonitorStats, MonitorSummary } from "./types";
import {
  formatLatency,
  formatRelativeTime,
  formatUptime,
  hostFromUrl,
  statusLabel,
  statusTone,
  toneDotClass,
  toneTextClass,
} from "./utils";

export function MonitorList({
  monitors,
  statsById,
  isLoading,
  hasSearch,
  runningId,
  onSelect,
  onToggle,
  onRunCheck,
  onCreate,
}: {
  monitors: MonitorSummary[];
  statsById?: Map<string, MonitorStats>;
  isLoading: boolean;
  hasSearch: boolean;
  runningId: string | null;
  onSelect: (monitor: MonitorSummary) => void;
  onToggle: (monitor: MonitorSummary, enabled: boolean) => void;
  onRunCheck: (monitor: MonitorSummary) => void;
  onCreate: () => void;
}) {
  const t = useUptimeT();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (monitors.length === 0) {
    if (hasSearch) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t.noSearchResults}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
          <IconWorldPin className="size-7 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">{t.emptyTitle}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          {t.emptyDescription}
        </p>
        <Button className="mt-5" size="sm" onClick={onCreate}>
          <IconPlus className="size-3.5" />
          {t.emptyCta}
        </Button>
      </div>
    );
  }

  const summary = summarizeMonitors(monitors, statsById);

  return (
    <div className="space-y-3">
      <StatusOverview summary={summary} />

      <div className="space-y-2">
        {monitors.map((monitor) => {
          const tone = statusTone(monitor.lastStatus);
          const lastChecked = formatRelativeTime(monitor.lastCheckedAt);
          const isRunning =
            runningId === monitor.id || monitor.lastStatus === "running";
          const timeline = statsById?.get(monitor.id)?.timeline ?? [];
          return (
            <div
              key={monitor.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(monitor)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(monitor);
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center gap-4 rounded-lg border border-border/50 bg-card px-4 py-3 transition-colors hover:border-border hover:bg-muted/30",
                !monitor.enabled && "opacity-60",
              )}
            >
              {/* Status + identity */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    toneDotClass(tone),
                    isRunning && "animate-pulse",
                  )}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {monitor.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-medium",
                        toneTextClass(tone),
                      )}
                    >
                      {statusLabel(monitor.lastStatus, t)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {hostFromUrl(monitor.url)}
                    {lastChecked ? (
                      <span className="text-muted-foreground/70">
                        {" · "}
                        {fmt(t.lastChecked, { time: lastChecked })}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Compact 90-day uptime bar */}
              <div className="hidden w-40 shrink-0 lg:block">
                <UptimeTimelineBars
                  buckets={timeline}
                  heightClassName="h-5"
                  barRadiusClassName="rounded-[1px]"
                  hideWhenEmpty
                  ariaLabel={fmt(t.uptimeTimelineAria, { name: monitor.name })}
                />
              </div>

              {/* Metrics */}
              <div className="hidden shrink-0 items-center gap-6 sm:flex">
                <Metric
                  label={t.latency}
                  value={formatLatency(monitor.lastLatencyMs)}
                />
                <Metric
                  label={t.uptime24h}
                  value={formatUptime(monitor.uptime24h)}
                />
                <Metric
                  label={t.uptime7d}
                  value={formatUptime(monitor.uptime7d)}
                />
              </div>

              {/* Actions */}
              <div
                className="flex shrink-0 items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      onClick={() => onRunCheck(monitor)}
                      disabled={isRunning}
                      aria-label={t.checkNow}
                    >
                      {isRunning ? (
                        <IconLoader2 className="size-3.5 animate-spin" />
                      ) : (
                        <IconPlayerPlay className="size-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t.checkNow}</TooltipContent>
                </Tooltip>
                <Switch
                  checked={monitor.enabled}
                  onCheckedChange={(enabled) => onToggle(monitor, enabled)}
                  aria-label={fmt(t.enableLabel, { name: monitor.name })}
                />
                <IconChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const OVERVIEW_DOT: Record<MonitorHealthTone, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  degraded: "bg-amber-500",
  neutral: "bg-muted-foreground/40",
};

function StatusOverview({ summary }: { summary: MonitorStatusSummary }) {
  const t = useUptimeT();
  const headline =
    summary.total === 0
      ? t.overviewNone
      : summary.overall === "up"
        ? t.overviewOperational
        : summary.overall === "degraded"
          ? t.overviewDegraded
          : summary.overall === "down"
            ? t.overviewDown
            : t.overviewPending;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/50 bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            OVERVIEW_DOT[summary.overall],
            summary.overall === "down" && "animate-pulse",
          )}
        />
        <span className="truncate text-sm font-medium">{headline}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {fmt(
            summary.total === 1 ? t.overviewOneMonitor : t.overviewMonitors,
            { count: summary.total },
          )}
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-emerald-500" />
          {fmt(t.upCount, { count: summary.up })}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-amber-500" />
          {fmt(t.degradedCount, { count: summary.degraded })}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-red-500" />
          {fmt(t.downCount, { count: summary.down })}
        </span>
        {summary.overallUptimePct != null ? (
          <span className="tabular-nums text-muted-foreground">
            {fmt(t.overviewUptime24h, {
              pct: formatUptime(summary.overallUptimePct),
            })}
          </span>
        ) : null}
        {summary.openIncidents > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-red-500">
            {fmt(t.overviewOpenIncidents, { count: summary.openIncidents })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-sm font-medium tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
