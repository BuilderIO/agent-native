import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconClock,
  IconEye,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useFormatters, useT } from "../i18n.js";
import { AutomationsList } from "../settings/AutomationsSection.js";
import type { AgentPageTabProps } from "./types.js";
import {
  useManageRecurringJob,
  useRecurringJobs,
  type RecurringJob,
} from "./use-jobs.js";

export function AgentJobsTab({
  scope,
  canManageOrg = false,
}: AgentPageTabProps) {
  const t = useT();
  const { formatDate } = useFormatters();
  const query = useRecurringJobs(scope);
  const mutation = useManageRecurringJob(scope);
  const [deleteTarget, setDeleteTarget] = useState<RecurringJob | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<RecurringJob | null>(null);

  const formatDateTime = (value: string | null) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return null;
    return formatDate(value, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const jobs = query.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 lg:p-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("jobs.agent", { defaultValue: "Agent" })}
        </p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("jobs.pageTitle", { defaultValue: "Jobs" })}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t("jobs.pageDescription", {
              defaultValue:
                "See recurring jobs and automations that run work for you.",
            })}
          </p>
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {t("jobs.recurringTitle", { defaultValue: "Recurring jobs" })}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {scope === "org"
                ? t("jobs.organizationRecurringDescription", {
                    defaultValue:
                      "Cron jobs shared with this organization. Members can view them; creators and admins can manage them.",
                  })
                : t("jobs.recurringDescription", {
                    defaultValue:
                      "Scheduled prompts that ask the agent to do work automatically.",
                  })}
            </p>
          </div>
          {scope === "org" && !canManageOrg ? (
            <span className="text-xs text-muted-foreground">
              {t("jobs.organizationMemberNote", {
                defaultValue: "You can manage jobs you created.",
              })}
            </span>
          ) : null}
        </div>

        {query.isLoading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            aria-busy="true"
          >
            <IconLoader2 className="size-4 animate-spin" />
            {t("jobs.loading", { defaultValue: "Loading…" })}
          </div>
        ) : query.error ? (
          <p className="text-sm text-destructive">
            {t("jobs.recurringLoadError", {
              defaultValue: "Could not load recurring jobs.",
            })}
          </p>
        ) : jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <IconClock className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {scope === "org"
                ? t("jobs.organizationEmpty", {
                    defaultValue: "No organization jobs yet.",
                  })
                : t("jobs.recurringEmpty", {
                    defaultValue:
                      "No recurring jobs yet. Ask the agent: “every morning, summarize my inbox”.",
                  })}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const lastRun = formatDateTime(job.lastRun);
              const nextRun = formatDateTime(job.nextRun);
              return (
                <article
                  key={job.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-muted-foreground">
                      <IconClock className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium">
                          {job.name.replace(/-/g, " ")}
                        </h3>
                        <span
                          className={
                            job.enabled
                              ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                              : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          }
                        >
                          {job.enabled
                            ? t("jobs.enabled", { defaultValue: "Enabled" })
                            : t("jobs.paused", { defaultValue: "Paused" })}
                        </span>
                        {job.lastStatus ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {job.lastStatus}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {job.scheduleDescription || job.schedule}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                        {job.instructions}
                      </p>
                      {lastRun || nextRun ? (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          {nextRun ? (
                            <span>
                              {t("jobs.nextRun", { defaultValue: "Next run" })}:{" "}
                              {nextRun}
                            </span>
                          ) : null}
                          {lastRun ? (
                            <span>
                              {t("jobs.lastRun", { defaultValue: "Last run" })}:{" "}
                              {lastRun}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="cursor-pointer px-2 text-xs"
                        onClick={() => setDetailsTarget(job)}
                      >
                        <IconEye className="size-3.5" />
                        {t("jobs.details", { defaultValue: "Details" })}
                      </Button>
                      {job.canUpdate ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer px-2 text-xs"
                            disabled={mutation.isPending}
                            onClick={() =>
                              mutation.mutate({
                                operation: "update",
                                name: job.name,
                                scope: job.scope,
                                enabled: !job.enabled,
                              })
                            }
                          >
                            {job.enabled ? (
                              <IconPlayerPause className="size-3.5" />
                            ) : (
                              <IconPlayerPlay className="size-3.5" />
                            )}
                            {job.enabled
                              ? t("jobs.pause", { defaultValue: "Pause" })
                              : t("jobs.resume", { defaultValue: "Resume" })}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 cursor-pointer text-muted-foreground hover:text-destructive"
                            aria-label={t("jobs.delete", {
                              defaultValue: "Delete",
                            })}
                            onClick={() => setDeleteTarget(job)}
                          >
                            <IconTrash className="size-3.5" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {mutation.error ? (
          <p className="text-sm text-destructive">
            {mutation.error.message ||
              t("jobs.recurringUpdateError", {
                defaultValue: "Could not update recurring job.",
              })}
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">
            {t("jobs.automationsTitle", { defaultValue: "Automations" })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === "org"
              ? t("jobs.organizationAutomationsDescription", {
                  defaultValue:
                    "Automations are personal today, so none are shown in the organization view.",
                })
              : t("jobs.automationsDescription", {
                  defaultValue:
                    "Event-triggered and scheduled agent tasks managed from one place.",
                })}
          </p>
        </div>
        <AutomationsList
          scope={scope}
          emptyMessage={
            scope === "org"
              ? t("jobs.automationsPersonalOnly", {
                  defaultValue: "Automations are personal today.",
                })
              : undefined
          }
        />
      </section>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("jobs.deleteRecurringTitle", {
                defaultValue: "Delete recurring job?",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("jobs.deleteRecurringDescription", {
                defaultValue:
                  "This permanently removes the job and cannot be undone.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              disabled={mutation.isPending}
              onClick={() => setDeleteTarget(null)}
            >
              {t("jobs.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="cursor-pointer"
              disabled={mutation.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                mutation.mutate(
                  {
                    operation: "delete",
                    name: deleteTarget.name,
                    scope: deleteTarget.scope,
                  },
                  { onSuccess: () => setDeleteTarget(null) },
                );
              }}
            >
              {mutation.isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : null}
              {t("jobs.delete", { defaultValue: "Delete" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsTarget(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detailsTarget?.name.replace(/-/g, " ") ??
                t("jobs.recurringDetails", {
                  defaultValue: "Recurring job details",
                })}
            </DialogTitle>
            <DialogDescription>
              {detailsTarget?.scheduleDescription || detailsTarget?.schedule}
            </DialogDescription>
          </DialogHeader>
          {detailsTarget ? (
            <div>
              <p className="text-xs font-medium text-foreground">
                {t("jobs.instructions", { defaultValue: "Instructions" })}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {detailsTarget.instructions}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
