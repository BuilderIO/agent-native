import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconClock,
  IconFileCode,
  IconRobot,
  IconTool,
} from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDuration, formatRelativeTime } from "./time";
import type { RunDisplayStatus } from "./run-status-pill";

interface RunSummaryCardProps {
  startedAt: number;
  completedAt: number | null;
  source: string;
  displayStatus: RunDisplayStatus;
  toolCallCount: number;
  touchedFileCount: number;
  currentBlocker: string | null;
  appearsStuck: boolean;
}

/**
 * Top-of-page summary card for the single run view.
 *
 * Surfaces the four facts a user wants on glance: when did this start,
 * what produced it, how much work has happened, and (if paused/failed/
 * stalled) what's keeping it from moving. Re-renders every 5s so the
 * elapsed time stays accurate without polling the action.
 */
export function RunSummaryCard({
  startedAt,
  completedAt,
  source,
  displayStatus,
  toolCallCount,
  touchedFileCount,
  currentBlocker,
  appearsStuck,
}: RunSummaryCardProps) {
  // Force the elapsed time to refresh once the surface has been open for a
  // while. Keeps the "1m ago" header from going stale on long-lived tabs.
  const [, force] = useState(0);
  useEffect(() => {
    if (displayStatus !== "running" && displayStatus !== "paused") return;
    const id = setInterval(() => force((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [displayStatus]);

  const elapsedMs = (completedAt ?? Date.now()) - startedAt;

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat
            icon={<IconClock size={16} aria-hidden />}
            label={
              completedAt
                ? "Ran for"
                : displayStatus === "running" || displayStatus === "paused"
                  ? "Elapsed"
                  : "Started"
            }
            value={
              completedAt ||
              displayStatus === "running" ||
              displayStatus === "paused"
                ? formatDuration(elapsedMs)
                : formatRelativeTime(startedAt, { suffix: "ago" })
            }
            hint={
              completedAt
                ? `Finished ${formatRelativeTime(completedAt, { suffix: "ago" })}`
                : `Started ${formatRelativeTime(startedAt, { suffix: "ago" })}`
            }
          />
          <SummaryStat
            icon={<IconRobot size={16} aria-hidden />}
            label="Source"
            value={sourceLabel(source)}
          />
          <SummaryStat
            icon={<IconTool size={16} aria-hidden />}
            label="Tool calls"
            value={String(toolCallCount)}
          />
          <SummaryStat
            icon={<IconFileCode size={16} aria-hidden />}
            label="Files touched"
            value={String(touchedFileCount)}
          />
        </div>

        {currentBlocker ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border p-3 text-sm",
              displayStatus === "failed"
                ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                : appearsStuck || displayStatus === "paused"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  : "border-muted bg-muted/30 text-muted-foreground",
            )}
          >
            <IconAlertTriangle
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
            <div className="space-y-0.5">
              <div className="text-xs font-semibold uppercase tracking-wide">
                {displayStatus === "failed"
                  ? "Error"
                  : displayStatus === "paused"
                    ? "Awaiting input"
                    : "Current blocker"}
              </div>
              <p>{currentBlocker}</p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case "agent-native":
      return "Agent-Native local";
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "copilot":
      return "GitHub Copilot";
    default:
      return source;
  }
}
