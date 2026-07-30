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
import { automationCreationContext } from "../settings/AutomationsSection.js";
import { AgentEmptyState } from "./AgentEmptyState.js";
import { AgentTabFrame } from "./AgentTabFrame.js";
import type { AgentPageTabProps } from "./types.js";
import {
  useAutomations,
  useManageAutomation,
  useManageRecurringJob,
  useRecurringJobs,
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
      triggerType: "event" | "schedule";
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

export function organizationAutomationCreationContext(): string {
  return "The user wants to create a new organization automation. Use manage-automations with action=define and scope=organization to create it. Ask clarifying questions if needed about whether it runs on a schedule or event, any conditions, and what actions to take.";
}

export function AgentJobsTab({ canManageOrg = false }: AgentPageTabProps) {
  const t = useT();
  const formatters = useFormatters();
  const personalJobsQuery = useRecurringJobs("user");
  const personalAutomationsQuery = useAutomations("user");
  const organizationJobsQuery = useRecurringJobs("org");
  const organizationAutomationsQuery = useAutomations("org");
  const personalJobsMutation = useManageRecurringJob("user");
  const personalAutomationsMutation = useManageAutomation("user");
  const organizationJobsMutation = useManageRecurringJob("org");
  const organizationAutomationsMutation = useManageAutomation("org");
  const [deleteTarget, setDeleteTarget] = useState<ListedAutomation | null>(
    null,
  );
  const [detailsTarget, setDetailsTarget] = useState<ListedAutomation | null>(
    null,
  );

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
    enabled?: boolean,
    onSuccess?: () => void,
  ) => {
    const input = {
      operation,
      name: entry.resource.name,
      scope: entry.resource.scope,
      ...(enabled === undefined ? {} : { enabled }),
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
                    "Describe a scheduled or event-triggered automation for this organization.",
                })
              : t("jobs.automationsEmptyDescription", {
                  defaultValue: "Describe what should happen and when.",
                })
          }
          action={
            organization ? null : (
              <AgentAskPopover
                context={automationCreationContext()}
                prompt={t("jobs.automationPrompt", {
                  defaultValue: "Create an automation that does this: ",
                })}
                title={t("jobs.automationsCreateTitle", {
                  defaultValue: "Create an automation",
                })}
              />
            )
          }
        />
      ) : (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {entries.map((entry) => {
            const resource = entry.resource;
            const lastRun = formatDateTime(resource.lastRun);
            const nextRun = formatDateTime(resource.nextRun);
            const triggerDescription =
              entry.kind === "automation" && entry.triggerType === "event"
                ? t("jobs.automationEventTrigger", {
                    defaultValue: "On {{event}}",
                    event: entry.resource.event ?? "event",
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
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                      {instructions}
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
                          disabled={mutationPending}
                          onClick={() =>
                            mutateEntry(entry, "update", !resource.enabled)
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
      )}
    </section>
  );

  const mutationError =
    personalJobsMutation.error ||
    personalAutomationsMutation.error ||
    organizationJobsMutation.error ||
    organizationAutomationsMutation.error;

  return (
    <AgentTabFrame
      title={t("jobs.pageTitle", { defaultValue: "Automations" })}
      description={t("jobs.pageDescription", {
        defaultValue:
          "Manage agent tasks that run on a schedule or in response to events.",
      })}
      actions={
        <AgentAskPopover
          context={automationCreationContext()}
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
        {renderSection({
          title: t("jobs.personal", { defaultValue: "Personal" }),
          description: t("jobs.personalDescription", {
            defaultValue:
              "Scheduled and event-triggered automations that run for you.",
          }),
          entries: personalEntries,
          loading:
            personalJobsQuery.isLoading || personalAutomationsQuery.isLoading,
          errors: [
            personalJobsQuery.error,
            personalAutomationsQuery.error,
          ].filter(Boolean),
        })}
        <div className="border-t border-border/70 pt-6">
          {renderSection({
            title: t("jobs.organization", { defaultValue: "Organization" }),
            description: t("jobs.organizationDescription", {
              defaultValue:
                "Scheduled and event-triggered automations shared with this organization.",
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
        open={detailsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsTarget(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detailsTarget?.resource.name.replace(/-/g, " ") ??
                t("jobs.automationDetails", {
                  defaultValue: "Automation details",
                })}
            </DialogTitle>
            <DialogDescription>
              {detailsTarget
                ? detailsTarget.triggerType === "event"
                  ? t("jobs.automationEventDetails", {
                      defaultValue: "Runs when {{event}}.",
                      event:
                        detailsTarget.kind === "automation"
                          ? (detailsTarget.resource.event ?? "an event fires")
                          : "an event fires",
                    })
                  : detailsTarget.resource.scheduleDescription ||
                    detailsTarget.resource.schedule ||
                    t("jobs.scheduledTrigger", {
                      defaultValue: "Scheduled",
                    })
                : null}
            </DialogDescription>
          </DialogHeader>
          {detailsTarget ? (
            <div className="space-y-3">
              {detailsTarget.kind === "automation" &&
              detailsTarget.resource.condition ? (
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {t("jobs.condition", { defaultValue: "Condition" })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {detailsTarget.resource.condition}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium text-foreground">
                  {t("jobs.instructions", { defaultValue: "Instructions" })}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {detailsTarget.kind === "automation"
                    ? detailsTarget.resource.body
                    : detailsTarget.resource.instructions}
                </p>
              </div>
              {(detailsTarget.resource.mcpTools ?? []).length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {t("jobs.mcpTools", {
                      defaultValue: "Connected MCP tools",
                    })}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(detailsTarget.resource.mcpTools ?? []).map((toolName) => (
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
