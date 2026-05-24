import { Link, useNavigate } from "react-router";
import { useEffect, useMemo, useState } from "react";
import {
  IconArrowRight,
  IconMessage,
  IconPlayerPlay,
  IconPlayerStop,
  IconTool,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useActionMutation } from "@agent-native/core/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RunStatusPill, type RunDisplayStatus } from "./run-status-pill";
import { formatRelativeTime } from "./time";

export interface RunCardData {
  runId: string;
  title: string;
  displayStatus: RunDisplayStatus;
  startedAt: number;
  completedAt: number | null;
  preview: string;
  appearsStuck: boolean;
}

interface RunListCardProps {
  run: RunCardData;
  /** Optional summary line (e.g. tool/file counts) shown under preview. */
  meta?: string;
}

/**
 * A single card in the Run Room list. Renders the status pill, run title,
 * agent-question preview, and state-aware action buttons.
 *
 * The whole card is clickable (navigates to the run detail) so reviewers
 * can scan and drill in fast.
 */
export function RunListCard({ run, meta }: RunListCardProps) {
  const navigate = useNavigate();
  const detailPath = `/runs/${encodeURIComponent(run.runId)}`;

  const stopMutation = useActionMutation<
    { ok: boolean; status?: string; message?: string; error?: string },
    { runId: string; reason?: string }
  >("stop-run", {
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.message ?? "Run stopped.");
      } else if (data.error) {
        toast.error(data.error);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const resumeMutation = useActionMutation<
    {
      ok: boolean;
      threadId?: string;
      error?: string;
    },
    { runId: string; message?: string }
  >("resume-run", {
    onSuccess: (data) => {
      if (data.ok) {
        toast.success("Resumed in the agent chat.");
      } else if (data.error) {
        toast.error(data.error);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Re-render the time label every 30s so the "X min ago" stays fresh on
  // long-lived tabs without polling the action.
  const [, force] = useState(0);
  useEffect(() => {
    if (run.displayStatus !== "running" && run.displayStatus !== "paused") {
      return;
    }
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [run.displayStatus]);

  const timeLabel = useMemo(() => {
    if (run.displayStatus === "running" || run.displayStatus === "paused") {
      return formatRelativeTime(run.startedAt, { suffix: "ago" });
    }
    return formatRelativeTime(run.completedAt ?? run.startedAt, {
      suffix: "ago",
    });
    // Time recomputes on render — the interval above triggers re-renders for
    // live runs; completed runs don't need to tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.displayStatus, run.startedAt, run.completedAt]);

  const isResumable =
    run.displayStatus === "paused" ||
    run.displayStatus === "failed" ||
    run.displayStatus === "stopped";
  const isStoppable = run.displayStatus === "running";

  return (
    <Card
      className={cn(
        "group cursor-pointer transition-all hover:-translate-y-px hover:shadow-md",
        run.appearsStuck && "border-amber-400/40",
      )}
      onClick={(e) => {
        // Don't trigger navigation when clicking a nested button/link.
        if ((e.target as HTMLElement).closest("button, a")) return;
        navigate(detailPath);
      }}
      role="link"
      aria-label={`Open run ${run.title}`}
    >
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <RunStatusPill status={run.displayStatus} />
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{timeLabel}</span>
            {run.appearsStuck && run.displayStatus === "running" ? (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <IconAlertTriangle size={12} aria-hidden />
                stalled
              </span>
            ) : null}
          </span>
        </div>

        <div className="space-y-1">
          <Link
            to={detailPath}
            className="block text-sm font-semibold text-foreground transition-colors hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            {run.title}
          </Link>
          {run.preview ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {run.displayStatus === "paused" ? (
                <span className="mr-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <IconMessage size={12} aria-hidden />
                  Asked:
                </span>
              ) : null}
              {run.preview}
            </p>
          ) : null}
          {meta ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconTool size={12} aria-hidden />
              {meta}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="default"
            className="cursor-pointer"
          >
            <Link to={detailPath} onClick={(e) => e.stopPropagation()}>
              Open
              <IconArrowRight size={14} aria-hidden />
            </Link>
          </Button>

          {isResumable ? (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              disabled={resumeMutation.isPending}
              onClick={(e) => {
                e.stopPropagation();
                resumeMutation.mutate({ runId: run.runId });
              }}
            >
              <IconPlayerPlay size={14} aria-hidden />
              Resume
            </Button>
          ) : null}

          {isStoppable ? (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              disabled={stopMutation.isPending}
              onClick={(e) => {
                e.stopPropagation();
                stopMutation.mutate({ runId: run.runId });
              }}
            >
              <IconPlayerStop size={14} aria-hidden />
              Stop
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
