import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconAlertTriangle,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";

import { requestAgentChatThreadOpen } from "../agent-chat.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { useAutomationRuns, type JobsScope } from "./use-jobs.js";

export interface AutomationDetailsField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface AutomationDetailsDialogProps {
  open: boolean;
  name: string;
  triggerSummary: string;
  fields: AutomationDetailsField[];
  condition: string | null;
  instructions: string;
  mcpTools: string[];
  lastError: string | null;
  scope: JobsScope;
  formatTimestamp: (value: number) => string;
  onClose: () => void;
}

function RunStatusDot({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-destructive"
        : // An interrupted run never reported an outcome, so it reads as
          // unknown rather than as still making progress.
          status === "interrupted"
          ? "bg-muted-foreground"
          : "bg-amber-500";
  return <span className={`size-1.5 shrink-0 rounded-full ${tone}`} />;
}

export function AutomationDetailsDialog({
  open,
  name,
  triggerSummary,
  fields,
  condition,
  instructions,
  mcpTools,
  lastError,
  scope,
  formatTimestamp,
  onClose,
}: AutomationDetailsDialogProps) {
  const t = useT();
  const runsQuery = useAutomationRuns(scope, open ? name : null, open);
  const runs = runsQuery.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{name.replace(/-/g, " ")}</DialogTitle>
          <DialogDescription>{triggerSummary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {lastError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-destructive">
                  {t("jobs.blockedTitle", {
                    defaultValue: "This automation is not running",
                  })}
                </p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {lastError}
                </p>
              </div>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {fields.map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                  {field.label}
                </dt>
                <dd
                  className={`mt-0.5 break-words text-sm ${
                    field.mono ? "font-mono text-xs" : ""
                  }`}
                >
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>

          {condition ? (
            <div>
              <p className="text-xs font-medium text-foreground">
                {t("jobs.condition", { defaultValue: "Condition" })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{condition}</p>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-medium text-foreground">
              {t("jobs.instructions", { defaultValue: "Instructions" })}
            </p>
            <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
              {instructions}
            </p>
          </div>

          {mcpTools.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-foreground">
                {t("jobs.mcpTools", { defaultValue: "Connected agent tools" })}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {mcpTools.map((toolName) => (
                  <code
                    key={toolName}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {toolName}
                  </code>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-medium text-foreground">
              {t("jobs.pastRuns", { defaultValue: "Past runs" })}
            </p>
            {runsQuery.isLoading ? (
              <div
                className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                aria-busy="true"
              >
                <IconLoader2 className="size-3.5 animate-spin" />
                {t("jobs.loading", { defaultValue: "Loading…" })}
              </div>
            ) : runsQuery.error ? (
              <p className="mt-1 text-xs text-destructive">
                {t("jobs.runsLoadError", {
                  defaultValue: "Could not load run history.",
                })}
              </p>
            ) : runs.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("jobs.noRuns", {
                  defaultValue:
                    "This automation has not executed yet. Only real executions are recorded here.",
                })}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border/60 border-y border-border/60">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center gap-2 py-1.5 text-xs"
                  >
                    <RunStatusDot status={run.status} />
                    <span className="shrink-0 text-muted-foreground">
                      {formatTimestamp(run.startedAt)}
                    </span>
                    <span className="shrink-0 font-medium">{run.status}</span>
                    {run.error ? (
                      <span
                        className="min-w-0 flex-1 truncate text-muted-foreground"
                        title={run.error}
                      >
                        {run.error}
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1" />
                    )}
                    {run.finishedAt ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {Math.round((run.finishedAt - run.startedAt) / 1000)}s
                      </span>
                    ) : null}
                    {run.error && run.threadId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                        onClick={() => {
                          requestAgentChatThreadOpen({
                            threadId: run.threadId as string,
                          });
                          onClose();
                        }}
                      >
                        <IconExternalLink className="size-3" />
                        Open thread
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
