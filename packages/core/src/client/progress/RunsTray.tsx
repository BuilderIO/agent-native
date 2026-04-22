import React, { useCallback, useEffect, useState } from "react";
import { IconLoader2, IconCheck, IconX, IconClock } from "@tabler/icons-react";

interface AgentRunDto {
  id: string;
  owner: string;
  title: string;
  step?: string;
  percent: number | null;
  status: "running" | "succeeded" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface RunsTrayProps {
  /** Poll interval in ms. 0 disables. Default 3000 (active runs need tight feedback). */
  pollMs?: number;
  /** Max runs to show. Default 5. */
  limit?: number;
  /** Only show when at least one run is active. Default true. */
  hideWhenIdle?: boolean;
  className?: string;
}

/**
 * Floating tray that lists the user's active agent runs with live progress.
 * Polls `/_agent-native/runs?active=true` so it only loads what's in-flight.
 */
export function RunsTray({
  pollMs = 3000,
  limit = 5,
  hideWhenIdle = true,
  className,
}: RunsTrayProps) {
  const [runs, setRuns] = useState<AgentRunDto[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/_agent-native/runs?active=true&limit=${limit}`);
      if (!res.ok) return;
      const rows = (await res.json()) as AgentRunDto[];
      setRuns(rows);
    } catch {
      // best-effort
    }
  }, [limit]);

  useEffect(() => {
    refresh();
    if (pollMs <= 0) return;
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refresh]);

  if (runs.length === 0 && hideWhenIdle) return null;

  return (
    <div
      className={
        "an-runs-tray fixed bottom-4 right-4 z-50 w-72 rounded-md border border-black/10 bg-white shadow-lg" +
        (className ? ` ${className}` : "")
      }
    >
      <div className="border-b border-black/10 px-3 py-2 text-sm font-medium">
        {runs.length === 0
          ? "No active runs"
          : `${runs.length} active run${runs.length > 1 ? "s" : ""}`}
      </div>
      <div className="divide-y divide-black/5">
        {runs.map((r) => (
          <RunRow key={r.id} run={r} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: AgentRunDto }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{run.title}</span>
        <StatusGlyph status={run.status} />
      </div>
      {run.step ? (
        <span className="truncate text-xs text-black/60">{run.step}</span>
      ) : null}
      {run.percent != null ? (
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-black/5">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${run.percent}%` }}
          />
        </div>
      ) : (
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-black/5">
          <div className="h-full w-1/3 animate-pulse bg-blue-300" />
        </div>
      )}
    </div>
  );
}

function StatusGlyph({ status }: { status: AgentRunDto["status"] }) {
  if (status === "running") {
    return (
      <IconLoader2
        size={14}
        className="animate-spin text-blue-600"
        aria-hidden
      />
    );
  }
  if (status === "succeeded") {
    return <IconCheck size={14} className="text-green-600" aria-hidden />;
  }
  if (status === "failed") {
    return <IconX size={14} className="text-red-600" aria-hidden />;
  }
  return <IconClock size={14} className="text-slate-500" aria-hidden />;
}
