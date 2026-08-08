import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconBolt,
  IconCalendarEvent,
  IconClock,
  IconAlertTriangle,
  IconChevronDown,
  IconEye,
  IconLoader2,
  IconMail,
  IconPencil,
  IconPlus,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useFormatters, useT } from "../i18n.js";
import { AgentEmptyState } from "./AgentEmptyState.js";
import { AgentTabFrame } from "./AgentTabFrame.js";
import {
  AutomationDetailsDialog,
  type AutomationDetailsField,
} from "./AutomationDetailsDialog.js";
import { AutomationEditorDialog } from "./AutomationEditorDialog.js";
import { AutomationScheduleDialog } from "./AutomationScheduleDialog.js";
import type { AgentPageTabProps } from "./types.js";
import {
  useAutomations,
  useManageAutomation,
  useManageRecurringJob,
  useRunAutomationNow,
  type Automation,
} from "./use-jobs.js";

type Translate = ReturnType<typeof useT>;

function describeTrigger(automation: Automation, t: Translate): string {
  if (automation.triggerType === "manual") {
    return t("jobs.automationManualDetails", {
      defaultValue: "Runs only when started on demand.",
    });
  }
  if (automation.triggerType === "event") {
    return t("jobs.automationEventDetails", {
      defaultValue: "Runs when {{event}}.",
      event: automation.event ?? "an event fires",
    });
  }
  return (
    automation.scheduleDescription ||
    automation.schedule ||
    t("jobs.scheduledTrigger", { defaultValue: "Scheduled" })
  );
}

function detailsFields(
  automation: Automation,
  t: Translate,
  formatDateTime: (value: string | null) => string | null,
): AutomationDetailsField[] {
  const unset = t("jobs.notSet", { defaultValue: "—" });
  const fields: AutomationDetailsField[] = [
    {
      label: t("jobs.status", { defaultValue: "Status" }),
      value: automation.enabled
        ? t("jobs.enabled", { defaultValue: "Enabled" })
        : t("jobs.paused", { defaultValue: "Paused" }),
    },
    {
      label: t("jobs.trigger", { defaultValue: "Trigger" }),
      value:
        automation.triggerType === "manual"
          ? t("jobs.manualTrigger", { defaultValue: "On demand" })
          : automation.triggerType === "event"
            ? t("jobs.eventTrigger", { defaultValue: "Event-triggered" })
            : t("jobs.scheduledTrigger", { defaultValue: "Scheduled" }),
    },
  ];

  if (automation.triggerType === "schedule") {
    fields.push(
      {
        label: t("jobs.cronExpression", { defaultValue: "Cron expression" }),
        value: automation.schedule || unset,
        mono: true,
      },
      {
        label: t("jobs.timezone", { defaultValue: "Timezone" }),
        value: automation.timezone || unset,
      },
    );
  }

  fields.push(
    {
      label: t("jobs.nextRun", { defaultValue: "Next run" }),
      value: formatDateTime(automation.nextRun) ?? unset,
    },
    {
      label: t("jobs.lastRun", { defaultValue: "Last run" }),
      value:
        formatDateTime(automation.lastRun) ??
        t("jobs.neverRan", { defaultValue: "Never" }),
    },
    {
      label: t("jobs.lastChecked", { defaultValue: "Last checked" }),
      value: formatDateTime(automation.lastCheck) ?? unset,
    },
    {
      label: t("jobs.lastStatus", { defaultValue: "Last status" }),
      value: automation.lastStatus || unset,
    },
    {
      label: t("jobs.sharingLabel", { defaultValue: "Sharing" }),
      value: sharingLabel(automation, t),
    },
    {
      label: t("jobs.createdBy", { defaultValue: "Created by" }),
      value: automation.createdBy || unset,
    },
  );

  if (automation.classification === "automation") {
    fields.push({
      label: t("jobs.model", { defaultValue: "Model" }),
      value: automation.model || unset,
    });
  }

  return fields;
}

function sharingLabel(automation: Automation, t: Translate): string {
  const sharing = automation.sharing;
  if (automation.effectiveRole !== "owner") {
    return sharing.visibility === "organization"
      ? t("jobs.sharingOrganization", { defaultValue: "Organization" })
      : automation.effectiveRole === "collaborate"
        ? t("jobs.sharingBadgeSharedCollaborate", {
            defaultValue: "Shared with you · Collaborate",
          })
        : t("jobs.sharingBadgeSharedView", {
            defaultValue: "Shared with you · View",
          });
  }
  if (sharing.visibility === "organization") {
    return t("jobs.sharingOrganization", { defaultValue: "Organization" });
  }
  if (sharing.visibility === "shared") {
    return t("jobs.sharingSpecificCount", {
      defaultValue: "Shared with {{count}} people",
      count: sharing.grantCount,
    });
  }
  return t("jobs.sharingPersonal", { defaultValue: "Personal" });
}

function initials(label: string): string {
  return label.slice(0, 2).toUpperCase();
}

function SharingBadge({
  automation,
  t,
}: {
  automation: Automation;
  t: Translate;
}) {
  const sharing = automation.sharing;
  const grants = sharing.grants ?? [];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {sharingLabel(automation, t)}
      {automation.effectiveRole === "owner" &&
      sharing.visibility === "shared" &&
      grants.length > 0 ? (
        <span className="flex -space-x-1.5">
          {grants.slice(0, 3).map((grant) => (
            <Avatar
              key={grant.email}
              className="size-4 border border-background"
            >
              {grant.avatar ? <img src={grant.avatar} alt="" /> : null}
              <AvatarFallback className="text-[8px]">
                {initials(grant.name || grant.email)}
              </AvatarFallback>
            </Avatar>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function AgentJobsTab({
  hideHeader = false,
}: AgentPageTabProps & { hideHeader?: boolean }) {
  const t = useT();
  const formatters = useFormatters();
  const automationsQuery = useAutomations();
  const automationsMutation = useManageAutomation();
  const jobsMutation = useManageRecurringJob();
  const runAutomationMutation = useRunAutomationNow();
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<Automation | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<Automation | null>(null);
  const [editorTarget, setEditorTarget] = useState<Automation | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<Automation | null>(null);

  const formatDateTime = (value: string | null) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return null;
    return formatters.formatDate(value, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const automations = automationsQuery.data ?? [];
  const mutationPending =
    automationsMutation.isPending || jobsMutation.isPending;

  const mutateAutomation = (
    automation: Automation,
    patch: { enabled?: boolean; schedule?: string; timezone?: string },
    onSuccess?: () => void,
  ) => {
    const options = onSuccess ? { onSuccess } : undefined;
    if (automation.classification === "automation") {
      automationsMutation.mutate(
        { operation: "update", resourceId: automation.resourceId, ...patch },
        options,
      );
    } else {
      jobsMutation.mutate(
        { operation: "update", resourceId: automation.resourceId, ...patch },
        options,
      );
    }
  };

  const deleteAutomation = (automation: Automation, onSuccess?: () => void) => {
    const options = onSuccess ? { onSuccess } : undefined;
    if (automation.classification === "automation") {
      automationsMutation.mutate(
        { operation: "delete", resourceId: automation.resourceId },
        options,
      );
    } else {
      jobsMutation.mutate(
        { operation: "delete", resourceId: automation.resourceId },
        options,
      );
    }
  };

  const openEditor = (automation: Automation | null) => {
    setEditorTarget(automation);
    setEditorOpen(true);
  };

  const mutationError =
    automationsMutation.error ||
    jobsMutation.error ||
    runAutomationMutation.error;

  const newAutomationButton = (
    <Button
      type="button"
      className="cursor-pointer gap-1.5"
      onClick={() => openEditor(null)}
    >
      <IconPlus className="size-4" />
      {t("jobs.newAutomation", { defaultValue: "New automation" })}
    </Button>
  );

  return (
    <AgentTabFrame
      compact={hideHeader}
      title={t("jobs.pageTitle", { defaultValue: "Automations" })}
      description={t("jobs.pageDescription", {
        defaultValue:
          "Manage agent tasks that run on a schedule or in response to events.",
      })}
      actions={newAutomationButton}
    >
      <div className="space-y-4">
        {hideHeader ? (
          <div className="flex justify-end">{newAutomationButton}</div>
        ) : null}

        {automationsQuery.error ? (
          <p className="text-sm text-destructive">
            {t("jobs.loadError", {
              defaultValue: "Could not load all automations.",
            })}
          </p>
        ) : null}

        {automationsQuery.isLoading && automations.length === 0 ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            aria-busy="true"
          >
            <IconLoader2 className="size-4 animate-spin" />
            {t("jobs.loading", { defaultValue: "Loading…" })}
          </div>
        ) : automations.length === 0 && !automationsQuery.error ? (
          <AgentEmptyState
            icon={IconCalendarEvent}
            title={t("jobs.automationsEmptyTitle", {
              defaultValue: "No automations yet",
            })}
            description={t("jobs.automationsEmptyDescription", {
              defaultValue: "Describe what should happen and when.",
            })}
            action={newAutomationButton}
            variant="card"
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
            <div className="divide-y divide-border/60 px-4">
              {automations.map((automation) => {
                const lastCheck = formatDateTime(automation.lastCheck);
                const isEventTrigger = automation.triggerType === "event";
                const isEmailTrigger =
                  isEventTrigger &&
                  automation.event === "mail.message.received";
                const isManualTrigger = automation.triggerType === "manual";
                const triggerDescription = isManualTrigger
                  ? t("jobs.automationManualDetails", {
                      defaultValue: "Runs only when started on demand.",
                    })
                  : isEventTrigger
                    ? t("jobs.automationEventTrigger", {
                        defaultValue: "On {{event}}",
                        event: automation.event ?? "event",
                      })
                    : automation.scheduleDescription ||
                      automation.schedule ||
                      t("jobs.scheduledTrigger", { defaultValue: "Scheduled" });

                return (
                  <article
                    key={automation.resourceId}
                    className="py-4 first:pt-5 last:pb-5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-muted-foreground">
                        {isManualTrigger ? (
                          <IconPlayerPlay className="size-4" />
                        ) : isEmailTrigger ? (
                          <IconMail className="size-4" />
                        ) : isEventTrigger ? (
                          <IconBolt className="size-4" />
                        ) : (
                          <IconClock className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-medium">
                            {automation.name.replace(/-/g, " ")}
                          </h3>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {isManualTrigger
                              ? t("jobs.manualTrigger", {
                                  defaultValue: "On demand",
                                })
                              : isEmailTrigger
                                ? t("jobs.emailTrigger", {
                                    defaultValue: "Email received",
                                  })
                                : isEventTrigger
                                  ? t("jobs.eventTrigger", {
                                      defaultValue: "Event-triggered",
                                    })
                                  : t("jobs.scheduledTrigger", {
                                      defaultValue: "Scheduled",
                                    })}
                          </span>
                          <span
                            className={
                              automation.enabled
                                ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                                : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            }
                          >
                            {automation.enabled
                              ? t("jobs.enabled", { defaultValue: "Enabled" })
                              : t("jobs.paused", { defaultValue: "Paused" })}
                          </span>
                          <SharingBadge automation={automation} t={t} />
                          {automation.lastStatus ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {automation.lastStatus}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {triggerDescription}
                        </p>
                        <p className="hidden">{automation.body}</p>
                        {lastCheck ? (
                          <div className="hidden">
                            <span>
                              {t("jobs.lastChecked", {
                                defaultValue: "Last checked",
                              })}
                              : {lastCheck}
                            </span>
                          </div>
                        ) : null}
                        {automation.lastError ? (
                          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                            <IconAlertTriangle className="mt-px size-3 shrink-0" />
                            <span className="min-w-0 break-words">
                              {automation.lastError}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {automation.capabilities.canOperate ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={automation.enabled}
                            aria-label={
                              automation.enabled
                                ? "Pause automation"
                                : "Resume automation"
                            }
                            disabled={mutationPending}
                            onClick={() =>
                              mutateAutomation(automation, {
                                enabled: !automation.enabled,
                              })
                            }
                            className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${automation.enabled ? "bg-primary" : "bg-muted"}`}
                          >
                            <span
                              className={`absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform ${automation.enabled ? "start-[18px]" : "start-0.5"}`}
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
                              {t("jobs.manage", { defaultValue: "Manage" })}
                              <IconChevronDown className="size-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-40 p-1">
                            <button
                              type="button"
                              onClick={() => setDetailsTarget(automation)}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent"
                            >
                              <IconEye className="size-3.5" />
                              {t("jobs.details", { defaultValue: "Details" })}
                            </button>
                            {automation.capabilities.canOperate ? (
                              <button
                                type="button"
                                disabled={runAutomationMutation.isPending}
                                onClick={() => setRunTarget(automation)}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
                              >
                                <IconPlayerPlay className="size-3.5" />
                                {t("jobs.runNow", { defaultValue: "Run now" })}
                              </button>
                            ) : null}
                            {automation.capabilities.canEdit ? (
                              <button
                                type="button"
                                onClick={() =>
                                  automation.classification === "automation"
                                    ? openEditor(automation)
                                    : setScheduleTarget(automation)
                                }
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent"
                              >
                                <IconPencil className="size-3.5" />
                                {t("jobs.edit", { defaultValue: "Edit" })}
                              </button>
                            ) : null}
                            {automation.capabilities.canDelete ? (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(automation)}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                              >
                                <IconTrash className="size-3.5" />
                                {t("jobs.delete", { defaultValue: "Delete" })}
                              </button>
                            ) : null}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
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
                deleteAutomation(deleteTarget, () => setDeleteTarget(null));
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
                  { resourceId: runTarget.resourceId },
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
          resourceId={detailsTarget.resourceId}
          name={detailsTarget.name}
          triggerSummary={describeTrigger(detailsTarget, t)}
          fields={detailsFields(detailsTarget, t, formatDateTime)}
          condition={
            detailsTarget.classification === "automation"
              ? detailsTarget.condition
              : null
          }
          instructions={detailsTarget.body}
          mcpTools={detailsTarget.mcpTools ?? []}
          lastError={detailsTarget.lastError}
          formatTimestamp={(value) =>
            formatDateTime(new Date(value).toISOString()) ?? String(value)
          }
          onClose={() => setDetailsTarget(null)}
        />
      ) : null}

      {scheduleTarget ? (
        <AutomationScheduleDialog
          open
          name={scheduleTarget.name}
          schedule={scheduleTarget.schedule ?? ""}
          timezone={scheduleTarget.timezone ?? null}
          saving={mutationPending}
          error={mutationError ? mutationError.message : null}
          onCancel={() => setScheduleTarget(null)}
          onSave={(next) =>
            mutateAutomation(scheduleTarget, next, () =>
              setScheduleTarget(null),
            )
          }
        />
      ) : null}

      <AutomationEditorDialog
        open={editorOpen}
        scope="personal"
        automation={editorTarget}
        saving={mutationPending}
        error={mutationError ? mutationError.message : null}
        onCancel={() => setEditorOpen(false)}
        onSave={(input) => {
          automationsMutation.mutate(input, {
            onSuccess: () => setEditorOpen(false),
          });
        }}
      />
    </AgentTabFrame>
  );
}
