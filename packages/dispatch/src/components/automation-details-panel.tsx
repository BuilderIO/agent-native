import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconClock,
  IconExternalLink,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { Link } from "react-router";

import {
  automationScopeLabel,
  automationStatus,
  automationTarget,
} from "../lib/automation-display";
import type { DispatchAutomationItem } from "../lib/automations";
import { ActionQueryError } from "./action-query-error";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

interface AutomationRun {
  id: string;
  runId: string | null;
  threadId: string | null;
  status: "running" | "success" | "error" | "interrupted";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface AutomationDetailsPanelProps {
  automation: DispatchAutomationItem;
  isToggling?: boolean;
  onToggle: () => void;
}

function formatTimestamp(value: number | string | null | undefined): string {
  if (value == null) return "Not recorded";
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
  return `/admin/thread-debug?${params.toString()}`;
}

function runStatusVariant(
  status: AutomationRun["status"],
): "default" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "success") return "default";
  return "outline";
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "mt-1 break-words font-mono text-xs text-foreground"
            : "mt-1 break-words text-sm text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function runAsLabel(value: DispatchAutomationItem["runAs"]): string {
  if (value === "creator") return "Creator identity";
  if (value === "shared") return "Shared identity";
  return "Default identity";
}

function scopeForRuns(automation: DispatchAutomationItem) {
  return automation.scope === "organization" ||
    automation.owner.startsWith("__organization__:") ||
    automation.owner === "__shared__"
    ? "organization"
    : "personal";
}

export function AutomationDetailsPanel({
  automation,
  isToggling = false,
  onToggle,
}: AutomationDetailsPanelProps) {
  const runsQuery = useActionQuery<AutomationRun[]>(
    "list-automation-runs",
    {
      name: automation.name,
      scope: scopeForRuns(automation),
      appId: automation.appId ?? "dispatch",
    },
    { staleTime: 5_000 },
  );
  const runs = runsQuery.data ?? [];
  const status = automationStatus(automation);
  const isScheduled = automation.triggerType !== "event";
  const prompt = automation.body?.trim();
  const hasExecutionTarget = Boolean(
    automation.executionHostId ||
    automation.executionEngine ||
    automation.executionCwd,
  );
  const hasDelivery = Boolean(
    automation.deliveryPlatform ||
    automation.deliveryDestination ||
    automation.deliveryThreadRef,
  );

  return (
    <aside className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-3 border-b p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={
                status.tone === "danger"
                  ? "size-2 shrink-0 rounded-full bg-destructive"
                  : status.tone === "default"
                    ? "size-2 shrink-0 rounded-full bg-primary"
                    : "size-2 shrink-0 rounded-full bg-muted-foreground/40"
              }
            />
            <Badge
              variant={status.tone === "danger" ? "destructive" : "outline"}
              className="h-5"
            >
              {status.label}
            </Badge>
          </div>
          <h2 className="mt-2 break-words text-base font-semibold text-foreground">
            {automation.name}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {isScheduled ? "Schedule" : "Event"} ·{" "}
            {automationScopeLabel(automation)}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <section>
          <h3 className="text-sm font-semibold text-foreground">Prompt</h3>
          {prompt ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-sans text-sm leading-6 text-foreground">
              {prompt}
            </pre>
          ) : (
            <p className="mt-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No prompt recorded.
            </p>
          )}
        </section>

        <section className="border-t pt-5">
          <h3 className="text-sm font-semibold text-foreground">
            Configuration
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
            <DetailField
              label="Trigger"
              value={isScheduled ? "Scheduled" : "Event-triggered"}
            />
            <DetailField
              label={isScheduled ? "Schedule" : "Event"}
              value={automationTarget(automation)}
            />
            {isScheduled ? (
              <>
                {automation.schedule ? (
                  <DetailField
                    label="Cron expression"
                    value={automation.schedule}
                    mono
                  />
                ) : null}
                <DetailField
                  label="Timezone"
                  value={automation.timezone || "Account default"}
                />
              </>
            ) : null}
            <DetailField
              label="Condition"
              value={automation.condition || "Always"}
            />
            <DetailField
              label="Domain"
              value={automation.domain || "Default"}
            />
            <DetailField
              label="Model"
              value={automation.model || "Default model"}
            />
            <DetailField label="Mode" value={automation.mode || "Agentic"} />
            <DetailField label="Runs as" value={runAsLabel(automation.runAs)} />
            <DetailField
              label="Next run"
              value={
                automation.enabled
                  ? formatTimestamp(automation.nextRun)
                  : "Paused"
              }
            />
            <DetailField
              label="Last run"
              value={formatTimestamp(automation.lastRun)}
            />
            <DetailField
              label="Last checked"
              value={formatTimestamp(automation.lastCheck)}
            />
            <DetailField
              label="Created by"
              value={automation.createdBy || "Unknown"}
            />
          </dl>
        </section>

        <section className="border-t pt-5">
          <h3 className="text-sm font-semibold text-foreground">
            Capabilities
          </h3>
          {automation.mcpTools && automation.mcpTools.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {automation.mcpTools.map((toolName) => (
                <code
                  key={toolName}
                  className="max-w-full break-all rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground"
                >
                  {toolName}
                </code>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No explicit tool allowlist.
            </p>
          )}
        </section>

        {hasExecutionTarget ? (
          <section className="border-t pt-5">
            <h3 className="text-sm font-semibold text-foreground">
              Execution target
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
              <DetailField
                label="Host"
                value={automation.executionHostId || "Server default"}
                mono={Boolean(automation.executionHostId)}
              />
              <DetailField
                label="Engine"
                value={automation.executionEngine || "Default"}
              />
              {automation.executionCwd ? (
                <DetailField
                  label="Working directory"
                  value={automation.executionCwd}
                  mono
                />
              ) : null}
            </dl>
          </section>
        ) : null}

        {hasDelivery ? (
          <section className="border-t pt-5">
            <h3 className="text-sm font-semibold text-foreground">Delivery</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
              {automation.deliveryPlatform ? (
                <DetailField
                  label="Platform"
                  value={automation.deliveryPlatform}
                />
              ) : null}
              {automation.deliveryDestination ? (
                <DetailField
                  label="Destination"
                  value={automation.deliveryDestination}
                />
              ) : null}
              {automation.deliveryThreadRef ? (
                <DetailField
                  label="Thread reference"
                  value={automation.deliveryThreadRef}
                  mono
                />
              ) : null}
            </dl>
          </section>
        ) : null}

        {automation.lastError ? (
          <section className="flex items-start gap-2 border-t border-destructive/30 pt-5">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-destructive">
                Latest scheduler result
              </h3>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {automation.lastError}
              </p>
            </div>
          </section>
        ) : null}

        <section className="border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Past runs</h3>
            {runs.length > 0 ? (
              <Badge variant="outline">{runs.length} shown</Badge>
            ) : null}
          </div>
          <div className="mt-3">
            {runsQuery.isLoading ? (
              <div className="space-y-3 rounded-md border p-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : runsQuery.isError ? (
              <ActionQueryError
                error={runsQuery.error}
                onRetry={() => void runsQuery.refetch()}
              />
            ) : runs.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No execution recorded yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
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
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t p-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggle}
          disabled={automation.canUpdate === false || isToggling}
        >
          {automation.enabled ? <IconPlayerPause /> : <IconPlayerPlay />}
          {automation.enabled ? "Pause" : "Resume"}
        </Button>
        {automation.canUpdate === false ? (
          <span className="text-xs text-muted-foreground">Read-only</span>
        ) : null}
      </footer>
    </aside>
  );
}
