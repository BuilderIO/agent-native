import {
  IconAlertCircle,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconLoader2,
  IconPlayerStop,
  IconSubtask,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentRun, ProgressStatus } from "../../progress/types.js";
import { agentNativePath } from "../api-path.js";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useFormatters, useT } from "../i18n.js";
import { useChangeVersion } from "../use-change-version.js";
import { usePausingInterval } from "../use-pausing-interval.js";
import { cn } from "../utils.js";

type AgentRunDto = AgentRun;
type RunsTrayTriggerVariant = "icon" | "pill";
const RUN_CHANGE_SETTLE_MS = 250;

interface RunsTrayProps {
  /** Poll interval in ms. 0 disables. Default 3000. */
  pollMs?: number;
  /** Max runs to show in the dropdown. Default 5. */
  limit?: number;
  /** Hide the trigger entirely when no active runs. Default true. */
  hideWhenIdle?: boolean;
  /** Include recent terminal runs instead of active runs only. Defaults to !hideWhenIdle. */
  showRecent?: boolean;
  /** Compact icon for app headers, or a labeled pill for the agent panel. */
  triggerVariant?: RunsTrayTriggerVariant;
  /** Called when a run can open a related agent chat thread. */
  onOpenThread?: (threadId: string, run: AgentRunDto) => void;
  align?: "start" | "center" | "end";
  className?: string;
}

interface RunsTrayState {
  runs: AgentRunDto[];
  hasRuns: boolean;
  activeCount: number;
  failedCount: number;
  terminalCount: number;
  triggerLabel: string;
  TriggerIcon: typeof IconLoader2;
  triggerTone: string;
  dismissRun: (runId: string) => void;
  stopRun: (runId: string) => void;
}

function useRunsTrayState({
  pollMs = 3000,
  limit = 5,
  hideWhenIdle = true,
  showRecent,
}: Pick<
  RunsTrayProps,
  "pollMs" | "limit" | "hideWhenIdle" | "showRecent"
>): RunsTrayState {
  const t = useT();
  const [runs, setRuns] = useState<AgentRunDto[]>([]);
  const includeRecent = showRecent ?? !hideWhenIdle;
  const runsVersion = useChangeVersion("runs");

  const refresh = useCallback(async () => {
    try {
      const query = new URLSearchParams({ limit: String(limit) });
      if (!includeRecent) query.set("active", "true");
      const res = await fetch(
        agentNativePath(`/_agent-native/runs?${query.toString()}`),
      );
      if (!res.ok) return;
      const rows = (await res.json()) as AgentRunDto[];
      setRuns(rows);
    } catch {
      // best-effort
    }
  }, [includeRecent, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (runsVersion <= 0) return;
    const timeout = window.setTimeout(
      () => void refresh(),
      RUN_CHANGE_SETTLE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [refresh, runsVersion]);

  usePausingInterval(refresh, pollMs);

  const dismissRun = useCallback(
    async (runId: string) => {
      setRuns((current) => current.filter((run) => run.id !== runId));
      try {
        const res = await fetch(
          agentNativePath(`/_agent-native/runs/${runId}`),
          {
            method: "DELETE",
            headers: { "X-Agent-Native-CSRF": "1" },
          },
        );
        if (!res.ok) throw new Error(`Dismiss failed (${res.status})`);
      } catch {
        refresh();
      }
    },
    [refresh],
  );

  const stopRun = useCallback(
    async (runId: string) => {
      // Optimistic: mark as cancelled immediately so the UI is responsive.
      setRuns((current) =>
        current.map((run) =>
          run.id === runId
            ? { ...run, status: "cancelled" as ProgressStatus }
            : run,
        ),
      );
      try {
        const res = await fetch(
          agentNativePath(`/_agent-native/agent-chat/runs/${runId}/stop`),
          {
            method: "POST",
            headers: { "X-Agent-Native-CSRF": "1" },
          },
        );
        if (!res.ok) throw new Error(`Stop failed (${res.status})`);
      } catch {
        // Reconcile from server on failure
        refresh();
      }
    },
    [refresh],
  );

  const hasRuns = runs.length > 0;
  const activeCount = useMemo(
    () => runs.filter((run) => run.status === "running").length,
    [runs],
  );
  const failedCount = useMemo(
    () => runs.filter((run) => run.status === "failed").length,
    [runs],
  );
  const triggerLabel =
    activeCount > 0
      ? t("runsTray.activeRun", { count: activeCount })
      : failedCount > 0
        ? t("runsTray.failedRun", { count: failedCount })
        : hasRuns
          ? t("runsTray.recentRuns")
          : t("runsTray.noRecentRuns");
  const TriggerIcon =
    activeCount > 0
      ? IconLoader2
      : failedCount > 0
        ? IconAlertCircle
        : IconSubtask;
  const triggerTone =
    activeCount > 0
      ? "text-primary"
      : failedCount > 0
        ? "text-destructive"
        : "text-muted-foreground";
  const terminalCount = runs.length - activeCount;

  return {
    runs,
    hasRuns,
    activeCount,
    failedCount,
    terminalCount,
    triggerLabel,
    TriggerIcon,
    triggerTone,
    dismissRun,
    stopRun,
  };
}

/**
 * Header-bar progress indicator. Shows a spinner icon or labeled Runs pill
 * with a count badge when runs are active; opens a popover with live progress.
 * Same inline-header pattern as <NotificationsBell /> — drop it into the
 * header, no floating overlay over the main content.
 */
export function RunsTray({
  pollMs = 3000,
  limit = 5,
  hideWhenIdle = true,
  showRecent,
  triggerVariant = "icon",
  onOpenThread,
  align = "end",
  className,
}: RunsTrayProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const {
    runs,
    hasRuns,
    activeCount,
    failedCount,
    terminalCount,
    triggerLabel,
    TriggerIcon,
    triggerTone,
    dismissRun,
    stopRun,
  } = useRunsTrayState({
    pollMs,
    limit,
    hideWhenIdle,
    showRecent,
  });

  if (!hasRuns && hideWhenIdle) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={triggerLabel}
                aria-expanded={open}
                className={cn(
                  "an-runs-tray__trigger relative inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  triggerVariant === "pill"
                    ? "h-7 min-w-[68px] gap-1.5 border border-border/70 bg-background px-2 text-[11px] font-medium"
                    : "h-8 w-8",
                  open && "bg-accent/50 text-foreground",
                  className,
                )}
              >
                <TriggerIcon
                  size={triggerVariant === "pill" ? 14 : 18}
                  className={cn(
                    triggerTone,
                    activeCount > 0 &&
                      "animate-spin motion-reduce:animate-none",
                  )}
                  aria-hidden
                />
                {triggerVariant === "pill" ? (
                  <span className="leading-none">{t("runsTray.runs")}</span>
                ) : null}
                {activeCount > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "an-runs-tray__badge rounded-full bg-primary text-[10px] font-medium leading-[14px] text-primary-foreground",
                      triggerVariant === "pill"
                        ? "min-w-4 px-1"
                        : "absolute -right-0.5 -top-0.5 px-1",
                    )}
                  >
                    {activeCount > 9 ? "9+" : activeCount}
                  </span>
                ) : failedCount > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "rounded-full bg-destructive text-[10px] font-medium leading-[14px] text-destructive-foreground",
                      triggerVariant === "pill"
                        ? "min-w-4 px-1"
                        : "absolute -right-0.5 -top-0.5 px-1",
                    )}
                  >
                    {failedCount > 9 ? "9+" : failedCount}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{triggerLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align={align}
        sideOffset={8}
        className="an-runs-tray__menu w-80 max-w-[calc(100vw-24px)] p-0"
      >
        <RunsTrayContent
          runs={runs}
          hasRuns={hasRuns}
          activeCount={activeCount}
          terminalCount={terminalCount}
          onDismiss={dismissRun}
          onStop={stopRun}
          onOpenThread={onOpenThread}
        />
      </PopoverContent>
    </Popover>
  );
}

export function RunsTrayMenuItem({
  pollMs = 3000,
  limit = 5,
  hideWhenIdle = false,
  showRecent = true,
  onOpenThread,
}: Pick<
  RunsTrayProps,
  "pollMs" | "limit" | "hideWhenIdle" | "showRecent" | "onOpenThread"
>) {
  const t = useT();
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const {
    runs,
    hasRuns,
    activeCount,
    failedCount,
    terminalCount,
    triggerLabel,
    TriggerIcon,
    triggerTone,
    dismissRun,
    stopRun,
  } = useRunsTrayState({
    pollMs,
    limit,
    hideWhenIdle,
    showRecent,
  });

  if (!hasRuns && hideWhenIdle) return null;

  return (
    <DropdownMenuSub open={submenuOpen} onOpenChange={setSubmenuOpen}>
      <DropdownMenuSubTrigger
        aria-label={t("runsTray.ariaAgentRuns", { label: triggerLabel })}
        className="cursor-pointer gap-2"
        onClick={(event) => {
          event.preventDefault();
          setSubmenuOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSubmenuOpen(true);
          }
        }}
      >
        <TriggerIcon
          size={14}
          className={cn(triggerTone, activeCount > 0 && "animate-spin")}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          {t("runsTray.agentRuns")}
        </span>
        {activeCount > 0 ? (
          <span
            aria-label={triggerLabel}
            className="rounded-full bg-primary px-1.5 text-[10px] font-medium leading-4 text-primary-foreground"
          >
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        ) : failedCount > 0 ? (
          <span
            aria-label={triggerLabel}
            className="rounded-full bg-destructive px-1.5 text-[10px] font-medium leading-4 text-destructive-foreground"
          >
            {failedCount > 9 ? "9+" : failedCount}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={6}
        className="an-runs-tray__menu w-80 max-w-[calc(100vw-24px)] p-0"
      >
        <RunsTrayContent
          runs={runs}
          hasRuns={hasRuns}
          activeCount={activeCount}
          terminalCount={terminalCount}
          onDismiss={dismissRun}
          onStop={stopRun}
          onOpenThread={onOpenThread}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function RunsTrayContent({
  runs,
  hasRuns,
  activeCount,
  terminalCount,
  onDismiss,
  onStop,
  onOpenThread,
}: {
  runs: AgentRunDto[];
  hasRuns: boolean;
  activeCount: number;
  terminalCount: number;
  onDismiss: (runId: string) => void;
  onStop: (runId: string) => void;
  onOpenThread?: (threadId: string, run: AgentRunDto) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-medium text-foreground">
          {t("runsTray.agentRuns")}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {activeCount > 0
            ? terminalCount > 0
              ? t("runsTray.summaryRunningRecent", {
                  activeCount,
                  terminalCount,
                })
              : t("runsTray.summaryRunning", { activeCount })
            : hasRuns
              ? t("runsTray.summaryRecent", { count: runs.length })
              : t("runsTray.noTrackedWorkYet")}
        </div>
      </div>
      {hasRuns ? (
        <div className="max-h-96 divide-y divide-border overflow-y-auto">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onDismiss={onDismiss}
              onStop={onStop}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      ) : (
        <div className="px-3 py-6 text-center">
          <IconClock
            size={22}
            className="mx-auto text-muted-foreground/50"
            aria-hidden
          />
          <div className="mt-2 text-sm font-medium text-foreground">
            {t("runsTray.noRecentRuns")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("runsTray.emptyDescription")}
          </p>
        </div>
      )}
    </>
  );
}

function getRunThreadId(run: AgentRunDto): string | undefined {
  const metadata = run.metadata ?? {};
  const direct =
    typeof metadata.threadId === "string"
      ? metadata.threadId
      : typeof metadata.thread_id === "string"
        ? metadata.thread_id
        : undefined;
  if (direct?.trim()) return direct.trim();

  const surfaceUrl =
    typeof metadata.surfaceUrl === "string" ? metadata.surfaceUrl : undefined;
  const match = surfaceUrl?.match(/^agent-native:\/\/threads\/(.+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function formatRunTime(
  run: AgentRunDto,
  t: ReturnType<typeof useT>,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
): string {
  const when = run.completedAt ?? run.updatedAt ?? run.startedAt;
  const timestamp = Date.parse(when);
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const isRunning = run.status === "running";
  if (diffMs < 30_000) {
    return t(
      isRunning ? "runsTray.updatedJustNow" : "runsTray.finishedJustNow",
    );
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return t(
      isRunning ? "runsTray.updatedMinutes" : "runsTray.finishedMinutes",
      {
        count: minutes,
      },
    );
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t(isRunning ? "runsTray.updatedHours" : "runsTray.finishedHours", {
      count: hours,
    });
  }
  return t(isRunning ? "runsTray.updatedDate" : "runsTray.finishedDate", {
    date: formatDate(timestamp, { month: "short", day: "numeric" }),
  });
}

function isAgentTeamRun(run: AgentRunDto): boolean {
  return (
    typeof run.metadata === "object" &&
    run.metadata !== null &&
    (run.metadata as Record<string, unknown>).kind === "agent-team"
  );
}

function RunRow({
  run,
  onDismiss,
  onStop,
  onOpenThread,
}: {
  run: AgentRunDto;
  onDismiss: (runId: string) => void;
  onStop: (runId: string) => void;
  onOpenThread?: (threadId: string, run: AgentRunDto) => void;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const threadId = getRunThreadId(run);
  const isRunning = run.status === "running";
  const canStop = isRunning && isAgentTeamRun(run);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">
            {run.title}
          </div>
          {run.step ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {run.step}
            </div>
          ) : null}
        </div>
        <StatusPill status={run.status} />
      </div>
      {run.percent != null || isRunning ? (
        <div className="h-1 w-full overflow-hidden rounded bg-muted">
          {run.percent != null ? (
            <div
              className={cn(
                "h-full origin-left transition-transform duration-200 ease-[var(--ease-collapse)]",
                run.status === "failed"
                  ? "bg-destructive"
                  : run.status === "cancelled"
                    ? "bg-muted-foreground/50"
                    : "bg-primary",
              )}
              style={{
                transform: `scaleX(${run.percent / 100})`,
                width: "100%",
              }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse bg-primary/60" />
          )}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-muted-foreground/70">
          {formatRunTime(run, t, formatDate)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {threadId && onOpenThread ? (
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={() => onOpenThread(threadId, run)}
            >
              {t("runsTray.open")}
              <IconExternalLink size={12} aria-hidden />
            </button>
          ) : null}
          {canStop ? (
            <button
              type="button"
              aria-label={t("runsTray.stopRun", { title: run.title })}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-destructive"
              onClick={() => onStop(run.id)}
            >
              <IconPlayerStop size={13} aria-hidden />
            </button>
          ) : null}
          {!isRunning ? (
            <button
              type="button"
              aria-label={t("runsTray.hideRun", { title: run.title })}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={() => onDismiss(run.id)}
            >
              <IconX size={13} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const STATUS_COPY_KEYS: Record<ProgressStatus, string> = {
  running: "runsTray.statusRunning",
  succeeded: "runsTray.statusDone",
  failed: "runsTray.statusFailed",
  cancelled: "runsTray.statusStopped",
};

const STATUS_PILL_STYLES: Record<ProgressStatus, string> = {
  running: "bg-primary/10 text-primary",
  succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: ProgressStatus }) {
  const t = useT();
  const { Icon, className } = STATUS_GLYPHS[status];
  const spinClass = status === "running" ? " animate-spin" : "";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium",
        STATUS_PILL_STYLES[status],
      )}
    >
      <Icon size={12} className={`${className}${spinClass}`} aria-hidden />
      {t(STATUS_COPY_KEYS[status])}
    </span>
  );
}

// dark: variants only where there's no semantic token for the colour
// (e.g. success green isn't in shadcn's default palette).
const STATUS_GLYPHS: Record<
  ProgressStatus,
  { Icon: typeof IconLoader2; className: string }
> = {
  running: { Icon: IconLoader2, className: "text-primary" },
  succeeded: {
    Icon: IconCheck,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  failed: { Icon: IconAlertCircle, className: "text-destructive" },
  cancelled: { Icon: IconClock, className: "text-muted-foreground" },
};
