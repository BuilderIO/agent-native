import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconClock,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import { Link } from "react-router";

import {
  automationScopeLabel,
  automationTarget,
} from "../lib/automation-display";
import type { DispatchAutomationItem } from "../lib/automations";
import { ActionQueryError } from "./action-query-error";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface AutomationRun {
  id: string;
  runId: string | null;
  threadId: string | null;
  status: "running" | "success" | "error" | "interrupted";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

interface AutomationRunHistoryDialogProps {
  automation: DispatchAutomationItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function runStatusVariant(
  status: AutomationRun["status"],
): "default" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "success") return "default";
  return "outline";
}

function formatTimestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function formatDuration(run: AutomationRun): string | null {
  if (!run.finishedAt) return null;
  const seconds = Math.max(
    0,
    Math.round((run.finishedAt - run.startedAt) / 1000),
  );
  return `${seconds}s`;
}

function runDebugPath(run: AutomationRun): string | null {
  const params = new URLSearchParams();
  if (run.runId) params.set("runId", run.runId);
  else if (run.threadId) params.set("threadId", run.threadId);
  else return null;
  return `/thread-debug?${params.toString()}`;
}

export function AutomationRunHistoryDialog({
  automation,
  open,
  onOpenChange,
}: AutomationRunHistoryDialogProps) {
  const scope =
    automation?.scope === "organization" ||
    automation?.owner.startsWith("__organization__:") ||
    automation?.owner === "__shared__"
      ? "organization"
      : "personal";
  const runsQuery = useActionQuery<AutomationRun[]>(
    "list-automation-runs",
    {
      name: automation?.name ?? "",
      scope,
    },
    {
      enabled: open && Boolean(automation),
      staleTime: 5_000,
    },
  );
  const runs = runsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{automation?.name ?? "Automation details"}</DialogTitle>
          <DialogDescription>
            {automation
              ? `${automationTarget(automation)} · ${automationScopeLabel(automation)}`
              : "Execution history"}
          </DialogDescription>
        </DialogHeader>

        {automation ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/20 p-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Status
                </div>
                <div className="mt-1 font-medium">
                  {automation.lastStatus ??
                    (automation.enabled ? "ready" : "paused")}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Last check
                </div>
                <div className="mt-1 font-medium">
                  {automation.lastCheck
                    ? formatTimestamp(new Date(automation.lastCheck).getTime())
                    : "Not recorded"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Created by
                </div>
                <div className="mt-1 break-words font-medium">
                  {automation.createdBy ?? "Unknown"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Timezone
                </div>
                <div className="mt-1 font-medium">
                  {automation.timezone ?? "Account default"}
                </div>
              </div>
            </div>

            {automation.lastError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-destructive">
                    Latest scheduler result
                  </p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {automation.lastError}
                  </p>
                </div>
              </div>
            ) : null}

            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Past runs
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only executions that actually started appear here. Blocked
                    or skipped scheduler checks are shown above, not as fake
                    runs.
                  </p>
                </div>
                {runs.length > 0 ? (
                  <Badge variant="outline">{runs.length} shown</Badge>
                ) : null}
              </div>

              <div className="mt-3">
                {runsQuery.isLoading ? (
                  <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                    <IconLoader2 className="size-4 animate-spin" />
                    Loading run history...
                  </div>
                ) : runsQuery.isError ? (
                  <ActionQueryError
                    error={runsQuery.error}
                    onRetry={() => void runsQuery.refetch()}
                  />
                ) : runs.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    This automation has not recorded an execution yet. If it is
                    enabled but shows no runs, inspect the latest scheduler
                    result and last check above.
                  </div>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {runs.map((run) => {
                      const debugPath = runDebugPath(run);
                      const duration = formatDuration(run);
                      return (
                        <li key={run.id} className="space-y-2 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant={runStatusVariant(run.status)}>
                              {run.status}
                            </Badge>
                            <span className="text-muted-foreground">
                              {formatTimestamp(run.startedAt)}
                            </span>
                            {duration ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <IconClock className="size-3.5" />
                                {duration}
                              </span>
                            ) : null}
                            {debugPath ? (
                              <Link
                                to={debugPath}
                                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
                              >
                                <IconExternalLink className="size-3.5" />
                                Open debug
                              </Link>
                            ) : null}
                          </div>
                          {run.error ? (
                            <p className="break-words text-sm text-destructive">
                              {run.error}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
