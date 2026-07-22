import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconBolt,
  IconCalendarEvent,
  IconClock,
  IconEye,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

import { AgentAskPopover } from "../AgentAskPopover.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useFormatters, useT } from "../i18n.js";
import {
  automationCreationContext,
  AutomationsList,
} from "../settings/AutomationsSection.js";
import { AgentEmptyState } from "./AgentEmptyState.js";
import { AgentTabFrame } from "./AgentTabFrame.js";
import type { AgentPageTabProps } from "./types.js";
import {
  useManageRecurringJob,
  useRecurringJobs,
  type RecurringJob,
} from "./use-jobs.js";

export function AgentJobsTab({ canManageOrg = false }: AgentPageTabProps) {
  const t = useT();
  const { formatDate } = useFormatters();
  const personalQuery = useRecurringJobs("user");
  const organizationQuery = useRecurringJobs("org");
  const personalMutation = useManageRecurringJob("user");
  const organizationMutation = useManageRecurringJob("org");
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

  const renderRecurringSection = (
    title: string,
    scope: "user" | "org",
    query: ReturnType<typeof useRecurringJobs>,
    mutation: ReturnType<typeof useManageRecurringJob>,
  ) => {
    const jobs = query.data ?? [];
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {scope === "org"
                ? t("jobs.organizationRecurringDescription", {
                    defaultValue:
                      "Jobs shared with this organization. Members can view them; creators and admins can manage them.",
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
          <AgentEmptyState
            icon={IconCalendarEvent}
            title={
              scope === "org"
                ? t("jobs.organizationEmptyTitle", {
                    defaultValue: "No organization jobs yet",
                  })
                : t("jobs.recurringEmptyTitle", {
                    defaultValue: "No recurring jobs yet",
                  })
            }
            description={
              scope === "org"
                ? t("jobs.organizationEmptyDescription", {
                    defaultValue:
                      "Describe a shared job for this organization.",
                  })
                : t("jobs.recurringEmptyDescription", {
                    defaultValue: "Describe what should run and when.",
                  })
            }
            action={
              <AgentAskPopover
                context={
                  scope === "org"
                    ? "The user wants to create an organization recurring job. Create it in the organization jobs resource with the schedule and instructions from their prompt."
                    : "The user wants to create a personal recurring job. Create it in the personal jobs resource with the schedule and instructions from their prompt."
                }
                prompt={
                  scope === "org"
                    ? t("jobs.organizationPrompt", {
                        defaultValue:
                          "Create a shared organization job that runs on a schedule and does this: ",
                      })
                    : t("jobs.recurringPrompt", {
                        defaultValue:
                          "Create a recurring job that runs on a schedule and does this: every morning, summarize my inbox.",
                      })
                }
                title={
                  scope === "org"
                    ? t("jobs.organizationCreateTitle", {
                        defaultValue: "Create an organization job",
                      })
                    : t("jobs.recurringCreateTitle", {
                        defaultValue: "Create a recurring job",
                      })
                }
              />
            }
          />
        ) : (
          <div className="divide-y divide-border/60 border-y border-border/60">
            {jobs.map((job) => {
              const lastRun = formatDateTime(job.lastRun);
              const nextRun = formatDateTime(job.nextRun);
              return (
                <article key={job.id} className="py-4 first:pt-5 last:pb-5">
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
    );
  };

  const mutationPending =
    personalMutation.isPending || organizationMutation.isPending;
  const deleteMutation =
    deleteTarget?.scope === "organization"
      ? organizationMutation
      : personalMutation;

  return (
    <AgentTabFrame
      title={t("jobs.pageTitle", { defaultValue: "Jobs" })}
      description={t("jobs.pageDescription", {
        defaultValue:
          "See recurring jobs and automations that run work for you.",
      })}
    >
      <div className="space-y-7">
        {renderRecurringSection(
          "Personal",
          "user",
          personalQuery,
          personalMutation,
        )}
        {renderRecurringSection(
          "Organization",
          "org",
          organizationQuery,
          organizationMutation,
        )}

        <section className="space-y-4 border-t border-border/70 pt-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {t("jobs.automationsTitle", { defaultValue: "Automations" })}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("jobs.automationsDescription", {
                defaultValue:
                  "Event-triggered and scheduled agent tasks managed from one place.",
              })}
            </p>
          </div>
          <AutomationsList
            scope="user"
            emptyState={
              <AgentEmptyState
                icon={IconBolt}
                title={t("jobs.automationsEmptyTitle", {
                  defaultValue: "No automations yet",
                })}
                description={t("jobs.automationsEmptyDescription", {
                  defaultValue: "Describe what should happen and when.",
                })}
                action={
                  <AgentAskPopover
                    context={automationCreationContext()}
                    prompt={t("jobs.automationPrompt", {
                      defaultValue: "Create an automation that does this: ",
                    })}
                    title={t("jobs.automationsCreateTitle", {
                      defaultValue: "Create an automation",
                    })}
                  />
                }
              />
            }
          />
        </section>
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !mutationPending) setDeleteTarget(null);
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
              disabled={mutationPending}
              onClick={() => setDeleteTarget(null)}
            >
              {t("jobs.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="cursor-pointer"
              disabled={mutationPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteMutation.mutate(
                  {
                    operation: "delete",
                    name: deleteTarget.name,
                    scope: deleteTarget.scope,
                  },
                  { onSuccess: () => setDeleteTarget(null) },
                );
              }}
            >
              {mutationPending ? (
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
              {detailsTarget.mcpTools.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-medium text-foreground">
                    {t("jobs.mcpTools", {
                      defaultValue: "Connected MCP tools",
                    })}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {detailsTarget.mcpTools.map((toolName) => (
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
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AgentTabFrame>
  );
}
