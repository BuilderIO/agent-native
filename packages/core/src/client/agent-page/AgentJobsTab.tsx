import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconBolt,
  IconCalendarEvent,
  IconClock,
  IconAlertTriangle,
  IconChevronDown,
  IconEye,
  IconLoader2,
  IconPencil,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useFormatters, useT } from "../i18n.js";
import { automationCreationContext } from "../settings/AutomationsSection.js";
import { AgentEmptyState } from "./AgentEmptyState.js";
import { AgentTabFrame } from "./AgentTabFrame.js";
import {
  AutomationDetailsDialog,
  type AutomationDetailsField,
} from "./AutomationDetailsDialog.js";
import { AutomationScheduleDialog } from "./AutomationScheduleDialog.js";
import {
  scheduleFiringFor,
  type ScheduleFiring,
} from "./scheduled-trigger-state.js";
import { ScheduledTriggerNotice } from "./ScheduledTriggerNotice.js";
import type { AgentPageTabProps } from "./types.js";
import {
  useAutomations,
  useManageAutomation,
  useManageRecurringJob,
  useRunAutomationNow,
  useRecurringJobs,
  useScheduledTriggerState,
  type Automation,
  type RecurringJob,
} from "./use-jobs.js";

type ListedAutomation =
  | {
      kind: "recurring";
      resource: RecurringJob;
      triggerType: "schedule";
    }
  | {
      kind: "automation";
      resource: Automation;
      triggerType: "event" | "schedule" | "webhook";
    };

function listRecurringJobs(jobs: RecurringJob[]): ListedAutomation[] {
  return jobs.map((resource) => ({
    kind: "recurring",
    resource,
    triggerType: "schedule",
  }));
}

function listAutomations(automations: Automation[]): ListedAutomation[] {
  return automations.map((resource) => ({
    kind: "automation",
    resource,
    triggerType: resource.triggerType,
  }));
}

type Translate = ReturnType<typeof useT>;

function describeTrigger(entry: ListedAutomation, t: Translate): string {
  if (entry.kind === "automation" && entry.triggerType === "event") {
    return t("jobs.automationEventDetails", {
      defaultValue: "Runs when {{event}}.",
      event: entry.resource.event ?? "an event fires",
    });
  }
  if (entry.kind === "automation" && entry.triggerType === "webhook") {
    return t("jobs.automationWebhookDetails", {
      defaultValue: "Runs when a webhook is received.",
    });
  }
  return (
    entry.resource.scheduleDescription ||
    entry.resource.schedule ||
    t("jobs.scheduledTrigger", { defaultValue: "Scheduled" })
  );
}

/**
 * `nextRun` is computed from the cron expression, not from anything that
 * promises to run it, so it must never be presented with more confidence than
 * the scheduler check earned. Three answers, three phrasings: a known-dead
 * scheduler replaces the date, an unverified one qualifies it, and a confirmed
 * one shows it plainly.
 */
function nextRunValue(
  entry: ListedAutomation,
  t: Translate,
  formatDateTime: (value: string | null) => string | null,
  scheduleFiring: ScheduleFiring,
  unset: string,
): string {
  const formatted = formatDateTime(entry.resource.nextRun);
  if (entry.triggerType !== "schedule" || scheduleFiring === "fires") {
    return formatted ?? unset;
  }
  if (scheduleFiring === "never") {
    return t("jobs.nextRunNeverScheduler", {
      defaultValue: "Never — no scheduler in this deploy",
    });
  }
  return formatted
    ? t("jobs.nextRunSchedulerUnknown", {
        defaultValue: "{{date}} — unconfirmed, the scheduler check failed",
        date: formatted,
      })
    : t("jobs.nextRunSchedulerUnknownNoDate", {
        defaultValue: "Unknown — the scheduler check failed",
      });
}

function detailsFields(
  entry: ListedAutomation,
  t: Translate,
  formatDateTime: (value: string | null) => string | null,
  scheduleFiring: ScheduleFiring,
): AutomationDetailsField[] {
  const resource = entry.resource;
  const unset = t("jobs.notSet", { defaultValue: "—" });
  const fields: AutomationDetailsField[] = [
    {
      label: t("jobs.status", { defaultValue: "Status" }),
      value: resource.enabled
        ? t("jobs.enabled", { defaultValue: "Enabled" })
        : t("jobs.paused", { defaultValue: "Paused" }),
    },
    {
      label: t("jobs.trigger", { defaultValue: "Trigger" }),
      value:
        entry.triggerType === "event"
          ? t("jobs.eventTrigger", { defaultValue: "Event-triggered" })
          : entry.triggerType === "webhook"
            ? t("jobs.webhookTrigger", { defaultValue: "Webhook-triggered" })
            : t("jobs.scheduledTrigger", { defaultValue: "Scheduled" }),
    },
  ];

  if (entry.triggerType === "schedule") {
    fields.push(
      {
        label: t("jobs.cronExpression", { defaultValue: "Cron expression" }),
        value: resource.schedule || unset,
        mono: true,
      },
      {
        label: t("jobs.timezone", { defaultValue: "Timezone" }),
        value: resource.timezone || unset,
      },
    );
  }
  if (entry.kind === "automation" && entry.triggerType === "webhook") {
    fields.push({
      label: t("jobs.webhookUrl", { defaultValue: "Webhook URL" }),
      value: entry.resource.webhookPath || unset,
      mono: true,
    });
  }

  fields.push(
    {
      label: t("jobs.nextRun", { defaultValue: "Next run" }),
      value: nextRunValue(entry, t, formatDateTime, scheduleFiring, unset),
    },
    {
      label: t("jobs.lastRun", { defaultValue: "Last run" }),
      value:
        formatDateTime(resource.lastRun) ??
        t("jobs.neverRan", { defaultValue: "Never" }),
    },
    {
      label: t("jobs.lastChecked", { defaultValue: "Last checked" }),
      value: formatDateTime(resource.lastCheck) ?? unset,
    },
    {
      label: t("jobs.lastStatus", { defaultValue: "Last status" }),
      value: resource.lastStatus || unset,
    },
    {
      label: t("jobs.scope", { defaultValue: "Scope" }),
      value:
        resource.scope === "organization"
          ? t("jobs.organization", { defaultValue: "Organization" })
          : t("jobs.personal", { defaultValue: "Personal" }),
    },
    {
      label: t("jobs.createdBy", { defaultValue: "Created by" }),
      value: resource.createdBy || unset,
    },
  );

  if (entry.kind === "automation") {
    fields.push({
      label: t("jobs.model", { defaultValue: "Model" }),
      value: entry.resource.model || unset,
    });
  }

  return fields;
}

export function organizationAutomationCreationContext(): string {
  return "The user wants to create a new organization automation. Use manage-automations with action=define and scope=organization to create it. Ask clarifying questions if needed about whether it runs on a schedule, event, or webhook, any conditions, and what actions to take.";
}

export function AgentJobsTab({
  canManageOrg = false,
  hideHeader = false,
  organizationId,
}: AgentPageTabProps & {
  hideHeader?: boolean;
  organizationId?: string | null;
}) {
  const t = useT();
  const formatters = useFormatters();
  const personalJobsQuery = useRecurringJobs("user");
  const personalAutomationsQuery = useAutomations("user");
  const organizationJobsQuery = useRecurringJobs("org");
  const organizationAutomationsQuery = useAutomations("org");
  const scheduledTriggerState = useScheduledTriggerState();
  // Three states, not `!== false`: that expression also swallowed a FAILED
  // status query, which then licensed a confident "Next run" forever. See
  // `scheduleFiringFor` for which way each state leans and why.
  const scheduleFiring = scheduleFiringFor(scheduledTriggerState);
  const personalJobsMutation = useManageRecurringJob("user");
  const personalAutomationsMutation = useManageAutomation("user");
  const organizationJobsMutation = useManageRecurringJob("org");
  const organizationAutomationsMutation = useManageAutomation("org");
  const runAutomationMutation = useRunAutomationNow();
  const organizationDraftScope = organizationId?.trim()
    ? `agent-jobs:organization-create:${organizationId}`
    : undefined;
  const [deleteTarget, setDeleteTarget] = useState<ListedAutomation | null>(
    null,
  );
  const [detailsTarget, setDetailsTarget] = useState<ListedAutomation | null>(
    null,
  );
  const [scheduleTarget, setScheduleTarget] = useState<ListedAutomation | null>(
    null,
  );
  const [runTarget, setRunTarget] = useState<ListedAutomation | null>(null);

  const formatDateTime = (value: string | null) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return null;
    return formatters.formatDate(value, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const personalEntries = [
    ...listRecurringJobs(personalJobsQuery.data ?? []),
    ...listAutomations(personalAutomationsQuery.data ?? []),
  ];
  const organizationEntries = [
    ...listRecurringJobs(organizationJobsQuery.data ?? []),
    ...listAutomations(organizationAutomationsQuery.data ?? []),
  ];
  const mutationPending =
    personalJobsMutation.isPending ||
    personalAutomationsMutation.isPending ||
    organizationJobsMutation.isPending ||
    organizationAutomationsMutation.isPending;

  const mutateEntry = (
    entry: ListedAutomation,
    operation: "update" | "delete",
    patch?: { enabled?: boolean; schedule?: string },
    onSuccess?: () => void,
  ) => {
    const input = {
      operation,
      name: entry.resource.name,
      scope: entry.resource.scope,
      ...patch,
    };
    const options = onSuccess ? { onSuccess } : undefined;

    if (entry.kind === "automation") {
      const mutation =
        entry.resource.scope === "organization"
          ? organizationAutomationsMutation
          : personalAutomationsMutation;
      mutation.mutate(input, options);
    } else if (entry.resource.scope === "organization") {
      organizationJobsMutation.mutate(input, options);
    } else {
      personalJobsMutation.mutate(input, options);
    }
  };

  const renderSection = ({
    title,
    description,
    entries,
    loading,
    errors,
    organization = false,
  }: {
    title: string;
    description: string;
    entries: ListedAutomation[];
    loading: boolean;
    errors: unknown[];
    organization?: boolean;
  }) => (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            {title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        {organization ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!canManageOrg ? (
              <span className="text-xs text-muted-foreground">
                {t("jobs.organizationMemberNote", {
                  defaultValue: "You can manage automations you created.",
                })}
              </span>
            ) : null}
            <AgentAskPopover
              context={organizationAutomationCreationContext()}
              draftScope={organizationDraftScope}
              prompt={t("jobs.organizationPrompt", {
                defaultValue:
                  "Create a shared organization automation that does this: ",
              })}
              title={t("jobs.automationsCreateTitle", {
                defaultValue: "Create an automation",
              })}
              label={t("jobs.newAutomation", {
                defaultValue: "New automation",
              })}
            />
          </div>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <p className="text-sm text-destructive">
          {t("jobs.loadError", {
            defaultValue: "Could not load all automations.",
          })}
        </p>
      ) : null}

      {loading && entries.length === 0 ? (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          aria-busy="true"
        >
          <IconLoader2 className="size-4 animate-spin" />
          {t("jobs.loading", { defaultValue: "Loading…" })}
        </div>
      ) : entries.length === 0 && errors.length === 0 ? (
        <AgentEmptyState
          icon={IconCalendarEvent}
          title={
            organization
              ? t("jobs.organizationEmptyTitle", {
                  defaultValue: "No organization automations yet",
                })
              : t("jobs.automationsEmptyTitle", {
                  defaultValue: "No automations yet",
                })
          }
          description={
            organization
              ? t("jobs.organizationEmptyDescription", {
                  defaultValue:
                    "Describe a scheduled, event-triggered, or webhook-triggered automation for this organization.",
                })
              : t("jobs.automationsEmptyDescription", {
                  defaultValue: "Describe what should happen and when.",
                })
          }
          action={
            organization ? null : (
              <AgentAskPopover
                context={automationCreationContext()}
                draftScope="agent-jobs:personal-empty-create"
                prompt={t("jobs.automationPrompt", {
                  defaultValue: "Create an automation that does this: ",
                })}
                title={t("jobs.automationsCreateTitle", {
                  defaultValue: "Create an automation",
                })}
              />
            )
          }
          variant="card"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
          <div className="divide-y divide-border/60 px-4">
            {entries.map((entry) => {
              const resource = entry.resource;
              const lastRun = formatDateTime(resource.lastRun);
              const lastCheck = formatDateTime(resource.lastCheck);
              const nextRun = formatDateTime(resource.nextRun);
              const triggerDescription =
                entry.kind === "automation" && entry.triggerType === "event"
                  ? t("jobs.automationEventTrigger", {
                      defaultValue: "On {{event}}",
                      event: entry.resource.event ?? "event",
                    })
                  : entry.kind === "automation" &&
                      entry.triggerType === "webhook"
                    ? t("jobs.automationWebhookTrigger", {
                        defaultValue: "On webhook",
                      })
                    : resource.scheduleDescription ||
                      resource.schedule ||
                      t("jobs.scheduledTrigger", {
                        defaultValue: "Scheduled",
                      });
              const instructions =
                entry.kind === "automation"
                  ? entry.resource.body
                  : entry.resource.instructions;

              return (
                <article
                  key={`${entry.kind}:${resource.id}`}
                  className="py-4 first:pt-5 last:pb-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-muted-foreground">
                      {entry.triggerType === "event" ? (
                        <IconCalendarEvent className="size-4" />
                      ) : entry.triggerType === "webhook" ? (
                        <IconBolt className="size-4" />
                      ) : (
                        <IconClock className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium">
                          {resource.name.replace(/-/g, " ")}
                        </h3>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {entry.triggerType === "event"
                            ? t("jobs.eventTrigger", {
                                defaultValue: "Event-triggered",
                              })
                            : entry.triggerType === "webhook"
                              ? t("jobs.webhookTrigger", {
                                  defaultValue: "Webhook-triggered",
                                })
                              : t("jobs.scheduledTrigger", {
                                  defaultValue: "Scheduled",
                                })}
                        </span>
                        <span
                          className={
                            resource.enabled
                              ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                              : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          }
                        >
                          {resource.enabled
                            ? t("jobs.enabled", { defaultValue: "Enabled" })
                            : t("jobs.paused", { defaultValue: "Paused" })}
                        </span>
                        {resource.lastStatus ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {resource.lastStatus}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {triggerDescription}
                      </p>
                      <p className="hidden">{instructions}</p>
                      {lastRun || nextRun || lastCheck ? (
                        <div className="hidden">
                          {nextRun ? (
                            <span>
                              {t("jobs.nextRun", { defaultValue: "Next run" })}:{" "}
                              {nextRun}
                            </span>
                          ) : null}
                          <span>
                            {t("jobs.lastRun", { defaultValue: "Last run" })}:{" "}
                            {lastRun ??
                              t("jobs.neverRan", { defaultValue: "Never" })}
                          </span>
                          {!lastRun && lastCheck ? (
                            <span>
                              {t("jobs.lastChecked", {
                                defaultValue: "Last checked",
                              })}
                              : {lastCheck}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {resource.lastError ? (
                        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                          <IconAlertTriangle className="mt-px size-3 shrink-0" />
                          <span className="min-w-0 break-words">
                            {resource.lastError}
                          </span>
                          <button
                            type="button"
                            className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
                            onClick={() => setDetailsTarget(entry)}
                          >
                            {t("jobs.viewDetails", {
                              defaultValue: "View details",
                            })}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {resource.canUpdate ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={resource.enabled}
                          aria-label={
                            resource.enabled
                              ? "Pause automation"
                              : "Resume automation"
                          }
                          disabled={mutationPending}
                          onClick={() =>
                            mutateEntry(entry, "update", {
                              enabled: !resource.enabled,
                            })
                          }
                          className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${resource.enabled ? "bg-primary" : "bg-muted"}`}
                        >
                          <span
                            className={`absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform ${resource.enabled ? "start-[18px]" : "start-0.5"}`}
                          />
                        </button>
                      ) : null}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="cursor-pointer gap-1 px-2.5 text-xs"
                          >
                            Manage
                            <IconChevronDown className="size-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-40 p-1">
                          <button
                            type="button"
                            onClick={() => setDetailsTarget(entry)}
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent"
                          >
                            <IconEye className="size-3.5" /> Details
                          </button>
                          {resource.canUpdate ? (
                            <>
                              <button
                                type="button"
                                disabled={runAutomationMutation.isPending}
                                onClick={() => setRunTarget(entry)}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
                              >
                                <IconPlayerPlay className="size-3.5" /> Run now
                              </button>
                              {entry.triggerType === "schedule" ? (
                                <button
                                  type="button"
                                  onClick={() => setScheduleTarget(entry)}
                                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent"
                                >
                                  <IconPencil className="size-3.5" /> Edit
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(entry)}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                              >
                                <IconTrash className="size-3.5" /> Delete
                              </button>
                            </>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="hidden">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="cursor-pointer px-2 text-xs"
                        onClick={() => setDetailsTarget(entry)}
                      >
                        <IconEye className="size-3.5" />
                        {t("jobs.details", { defaultValue: "Details" })}
                      </Button>
                      {resource.canUpdate ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer px-2 text-xs"
                            disabled={
                              mutationPending || runAutomationMutation.isPending
                            }
                            onClick={() => setRunTarget(entry)}
                          >
                            <IconPlayerPlay className="size-3.5" />
                            {t("jobs.runNow", { defaultValue: "Run now" })}
                          </Button>
                          {entry.triggerType === "schedule" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer px-2 text-xs"
                              disabled={mutationPending}
                              onClick={() => setScheduleTarget(entry)}
                            >
                              <IconPencil className="size-3.5" />
                              {t("jobs.edit", { defaultValue: "Edit" })}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer px-2 text-xs"
                            disabled={mutationPending}
                            onClick={() =>
                              mutateEntry(entry, "update", {
                                enabled: !resource.enabled,
                              })
                            }
                          >
                            {resource.enabled ? (
                              <IconPlayerPause className="size-3.5" />
                            ) : (
                              <IconPlayerPlay className="size-3.5" />
                            )}
                            {resource.enabled
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
                            onClick={() => setDeleteTarget(entry)}
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
        </div>
      )}
    </section>
  );

  const mutationError =
    personalJobsMutation.error ||
    personalAutomationsMutation.error ||
    organizationJobsMutation.error ||
    organizationAutomationsMutation.error ||
    runAutomationMutation.error;

  return (
    <AgentTabFrame
      compact={hideHeader}
      title={t("jobs.pageTitle", { defaultValue: "Automations" })}
      description={t("jobs.pageDescription", {
        defaultValue:
          "Manage agent tasks that run on a schedule, in response to events, or from webhooks.",
      })}
      actions={
        <AgentAskPopover
          context={automationCreationContext()}
          draftScope="agent-jobs:page-create"
          prompt={t("jobs.automationPrompt", {
            defaultValue: "Create an automation that does this: ",
          })}
          title={t("jobs.automationsCreateTitle", {
            defaultValue: "Create an automation",
          })}
          label={t("jobs.newAutomation", {
            defaultValue: "New automation",
          })}
        />
      }
    >
      <div className="space-y-7">
        <ScheduledTriggerNotice state={scheduledTriggerState} />
        {hideHeader ? (
          <div className="flex justify-end">
            <AgentAskPopover
              context={automationCreationContext()}
              draftScope="agent-jobs:compact-create"
              prompt={t("jobs.automationPrompt", {
                defaultValue: "Create an automation that does this: ",
              })}
              title={t("jobs.automationsCreateTitle", {
                defaultValue: "Create an automation",
              })}
              label={t("jobs.newAutomation", {
                defaultValue: "New automation",
              })}
            />
          </div>
        ) : null}
        {renderSection({
          title: t("jobs.personal", { defaultValue: "Personal" }),
          description: t("jobs.personalDescription", {
            defaultValue:
              "Scheduled, event-triggered, and webhook-triggered automations that run for you.",
          }),
          entries: personalEntries,
          loading:
            personalJobsQuery.isLoading || personalAutomationsQuery.isLoading,
          errors: [
            personalJobsQuery.error,
            personalAutomationsQuery.error,
          ].filter(Boolean),
        })}
        <div className="pt-2">
          {renderSection({
            title: t("jobs.organization", { defaultValue: "Organization" }),
            description: t("jobs.organizationDescription", {
              defaultValue:
                "Scheduled, event-triggered, and webhook-triggered automations shared with this organization.",
            }),
            entries: organizationEntries,
            loading:
              organizationJobsQuery.isLoading ||
              organizationAutomationsQuery.isLoading,
            errors: [
              organizationJobsQuery.error,
              organizationAutomationsQuery.error,
            ].filter(Boolean),
            organization: true,
          })}
        </div>
        {mutationError ? (
          <p className="text-sm text-destructive">
            {mutationError.message ||
              t("jobs.updateError", {
                defaultValue: "Could not update automation.",
              })}
          </p>
        ) : null}
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
              {t("jobs.deleteAutomationTitle", {
                defaultValue: "Delete automation?",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("jobs.deleteAutomationDescription", {
                defaultValue:
                  "This permanently removes the automation and cannot be undone.",
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
                mutateEntry(deleteTarget, "delete", undefined, () =>
                  setDeleteTarget(null),
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
        open={runTarget !== null}
        onOpenChange={(open) => {
          if (!open && !runAutomationMutation.isPending) setRunTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("jobs.runNowTitle", { defaultValue: "Run automation now?" })}
            </DialogTitle>
            <DialogDescription>
              {t("jobs.runNowDescription", {
                defaultValue:
                  "This runs the automation's real actions immediately. It may send messages or change data, and it will not change the next scheduled run.",
              })}
            </DialogDescription>
          </DialogHeader>
          {runAutomationMutation.error ? (
            <p className="text-sm text-destructive">
              {runAutomationMutation.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              disabled={runAutomationMutation.isPending}
              onClick={() => setRunTarget(null)}
            >
              {t("jobs.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={runAutomationMutation.isPending}
              onClick={() => {
                if (!runTarget) return;
                runAutomationMutation.mutate(
                  {
                    name: runTarget.resource.name,
                    scope: runTarget.resource.scope,
                  },
                  { onSuccess: () => setRunTarget(null) },
                );
              }}
            >
              {runAutomationMutation.isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconPlayerPlay className="size-4" />
              )}
              {t("jobs.runNow", { defaultValue: "Run now" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detailsTarget ? (
        <AutomationDetailsDialog
          open
          name={detailsTarget.resource.name}
          scope={
            detailsTarget.resource.scope === "organization" ? "org" : "user"
          }
          triggerSummary={describeTrigger(detailsTarget, t)}
          fields={detailsFields(
            detailsTarget,
            t,
            formatDateTime,
            scheduleFiring,
          )}
          condition={
            detailsTarget.kind === "automation"
              ? detailsTarget.resource.condition
              : null
          }
          instructions={
            detailsTarget.kind === "automation"
              ? detailsTarget.resource.body
              : detailsTarget.resource.instructions
          }
          mcpTools={detailsTarget.resource.mcpTools ?? []}
          lastError={detailsTarget.resource.lastError}
          formatTimestamp={(value) =>
            formatDateTime(new Date(value).toISOString()) ?? String(value)
          }
          onClose={() => setDetailsTarget(null)}
        />
      ) : null}

      {scheduleTarget ? (
        <AutomationScheduleDialog
          open
          name={scheduleTarget.resource.name}
          schedule={scheduleTarget.resource.schedule ?? ""}
          timezone={scheduleTarget.resource.timezone ?? null}
          saving={mutationPending}
          error={mutationError ? mutationError.message : null}
          scheduledTriggerState={scheduledTriggerState}
          onCancel={() => setScheduleTarget(null)}
          onSave={(next) =>
            mutateEntry(scheduleTarget, "update", next, () =>
              setScheduleTarget(null),
            )
          }
        />
      ) : null}
    </AgentTabFrame>
  );
}
