import { agentNativePath } from "../api-path.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconLoader2, IconCheck, IconX, IconClock } from "@tabler/icons-react";
import { usePausingInterval } from "../use-pausing-interval.js";
import type { AgentRun, ProgressStatus } from "../../progress/types.js";

type AgentRunDto = AgentRun;

interface RunsTrayProps {
  /** Poll interval in ms. 0 disables. Default 3000. */
  pollMs?: number;
  /** Max runs to show in the dropdown. Default 5. */
  limit?: number;
  /** Hide the trigger entirely when no active runs. Default true. */
  hideWhenIdle?: boolean;
  className?: string;
}

/**
 * Header-bar progress indicator. Shows a spinner icon with a count badge
 * when runs are active; opens a dropdown with live progress bars for each.
 * Same inline-header pattern as <NotificationsBell /> — drop it into the
 * header, no floating overlay over the main content.
 */
export function RunsTray({
  pollMs = 3000,
  limit = 5,
  hideWhenIdle = true,
  className,
}: RunsTrayProps) {
  const [runs, setRuns] = useState<AgentRunDto[]>([]);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/runs?active=true&limit=${limit}`),
      );
      if (!res.ok) return;
      const rows = (await res.json()) as AgentRunDto[];
      setRuns(rows);
    } catch {
      // best-effort
    }
  }, [limit]);

  usePausingInterval(refresh, pollMs);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Close the dropdown when the last active run finishes.
  useEffect(() => {
    if (runs.length === 0 && open) setOpen(false);
  }, [runs.length, open]);

  const hasRuns = runs.length > 0;
  if (!hasRuns && hideWhenIdle) return null;

  return (
    <div
      ref={menuRef}
      className={
        "an-runs-tray relative inline-flex" + (className ? ` ${className}` : "")
      }
    >
      <button
        type="button"
        aria-label={
          hasRuns
            ? `${runs.length} active run${runs.length > 1 ? "s" : ""}`
            : "No active runs"
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="an-runs-tray__trigger relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <IconLoader2
          size={18}
          className={hasRuns ? "animate-spin text-primary" : ""}
          aria-hidden
        />
        {hasRuns ? (
          <span
            aria-hidden
            className="an-runs-tray__badge absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[10px] leading-[14px] font-medium text-primary-foreground"
          >
            {runs.length > 9 ? "9+" : runs.length}
          </span>
        ) : null}
      </button>
      {open && hasRuns ? (
        <div
          role="menu"
          className="an-runs-tray__menu absolute right-0 top-full z-50 mt-2 w-80 rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            {runs.length} active run{runs.length > 1 ? "s" : ""}
          </div>
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RunRow({ run }: { run: AgentRunDto }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-foreground">
          {run.title}
        </span>
        <StatusGlyph status={run.status} />
      </div>
      {run.step ? (
        <span className="truncate text-xs text-muted-foreground">
          {run.step}
        </span>
      ) : null}
      {run.percent != null ? (
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${run.percent}%` }}
          />
        </div>
      ) : (
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-muted">
          <div className="h-full w-1/3 animate-pulse bg-primary/60" />
        </div>
      )}
    </div>
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
    className: "text-green-600 dark:text-green-400",
  },
  failed: { Icon: IconX, className: "text-destructive" },
  cancelled: { Icon: IconClock, className: "text-muted-foreground" },
};

function StatusGlyph({ status }: { status: ProgressStatus }) {
  const { Icon, className } = STATUS_GLYPHS[status];
  const spinClass = status === "running" ? " animate-spin" : "";
  return <Icon size={14} className={`${className}${spinClass}`} aria-hidden />;
}
