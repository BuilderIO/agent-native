import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconBolt,
  IconClock,
  IconEye,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";

import { sendToAgentChat } from "../agent-chat.js";
import {
  useAutomations,
  useManageAutomation,
  type Automation,
  type JobsScope,
} from "../agent-page/use-jobs.js";
import { agentNativePath } from "../api-path.js";
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
import { PromptComposer } from "../composer/PromptComposer.js";
import { useFormatters, useT } from "../i18n.js";

export interface AutomationsListProps {
  scope?: JobsScope;
  compact?: boolean;
  emptyMessage?: string;
}

export const AUTOMATION_CREATION_SCOPE = "personal" as const;

export function automationCreationContext(): string {
  return `The user wants to create a new ${AUTOMATION_CREATION_SCOPE} automation. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`;
}

export function AutomationsList({
  scope = "user",
  compact = false,
  emptyMessage,
}: AutomationsListProps) {
  const t = useT();
  const { formatDate } = useFormatters();
  const query = useAutomations(scope);
  const mutation = useManageAutomation(scope);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<Automation | null>(null);

  const formatDateTime = (value: string | null) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return null;
    return formatDate(value, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (query.isLoading) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        aria-busy="true"
      >
        <IconLoader2 className="size-4 animate-spin" />
        {t("jobs.loading", { defaultValue: "Loading…" })}
      </div>
    );
  }

  if (query.error) {
    return (
      <p className="text-sm text-destructive">
        {t("jobs.automationsLoadError", {
          defaultValue: "Could not load automations.",
        })}
      </p>
    );
  }

  const automations = query.data ?? [];
  if (automations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyMessage ??
          t("jobs.automationsEmpty", {
            defaultValue:
              "No automations yet. Ask the agent to set up an event-triggered or scheduled task.",
          })}
      </p>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {automations.map((automation) => {
        const lastRun = formatDateTime(automation.lastRun);
        const nextRun = formatDateTime(automation.nextRun);
        const trigger =
          automation.triggerType === "event"
            ? t("jobs.automationEventTrigger", {
                defaultValue: "On {{event}}",
                event: automation.event ?? "event",
              })
            : (automation.scheduleDescription ??
              automation.schedule ??
              t("jobs.automationScheduleTrigger", {
                defaultValue: "Scheduled task",
              }));

        return (
          <article
            key={automation.id}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-muted-foreground">
                {automation.triggerType === "event" ? (
                  <IconBolt className="size-4" />
                ) : (
                  <IconClock className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-foreground">
                    {automation.name.replace(/-/g, " ")}
                  </h3>
                  <span
                    className={
                      automation.enabled
                        ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                        : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    }
                  >
                    {automation.enabled
                      ? t("jobs.enabled", { defaultValue: "Enabled" })
                      : t("jobs.disabled", { defaultValue: "Disabled" })}
                  </span>
                  {automation.lastStatus ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {automation.lastStatus}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{trigger}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                  {automation.body}
                </p>
                {lastRun || nextRun ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {lastRun ? (
                      <span>
                        {t("jobs.lastRun", { defaultValue: "Last run" })}:{" "}
                        {lastRun}
                      </span>
                    ) : null}
                    {nextRun ? (
                      <span>
                        {t("jobs.nextRun", { defaultValue: "Next run" })}:{" "}
                        {nextRun}
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
                  onClick={() => setDetailsTarget(automation)}
                >
                  <IconEye className="size-3.5" />
                  {t("jobs.details", { defaultValue: "Details" })}
                </Button>
                {automation.canUpdate ? (
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
                          name: automation.name,
                          scope: automation.scope,
                          enabled: !automation.enabled,
                        })
                      }
                    >
                      {automation.enabled ? (
                        <IconPlayerPause className="size-3.5" />
                      ) : (
                        <IconPlayerPlay className="size-3.5" />
                      )}
                      {automation.enabled
                        ? t("jobs.pause", { defaultValue: "Pause" })
                        : t("jobs.resume", { defaultValue: "Resume" })}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 cursor-pointer text-muted-foreground hover:text-destructive"
                      aria-label={t("jobs.delete", { defaultValue: "Delete" })}
                      onClick={() => setDeleteTarget(automation)}
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

      {mutation.error ? (
        <p className="text-sm text-destructive">
          {mutation.error.message ||
            t("jobs.automationUpdateError", {
              defaultValue: "Could not update automation.",
            })}
        </p>
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setDeleteTarget(null);
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
                t("jobs.automationDetails", {
                  defaultValue: "Automation details",
                })}
            </DialogTitle>
            <DialogDescription>
              {detailsTarget
                ? detailsTarget.triggerType === "event"
                  ? t("jobs.automationEventDetails", {
                      defaultValue: "Runs when {{event}}.",
                      event: detailsTarget.event ?? "an event fires",
                    })
                  : (detailsTarget.scheduleDescription ??
                    detailsTarget.schedule ??
                    t("jobs.automationScheduleTrigger", {
                      defaultValue: "Scheduled task",
                    }))
                : null}
            </DialogDescription>
          </DialogHeader>
          {detailsTarget ? (
            <div className="space-y-3">
              {detailsTarget.condition ? (
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {t("jobs.condition", { defaultValue: "Condition" })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {detailsTarget.condition}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium text-foreground">
                  {t("jobs.instructions", { defaultValue: "Instructions" })}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {detailsTarget.body}
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AutomationsSection() {
  const t = useT();
  const { data: automations = [] } = useAutomations("user");
  const [newOpen, setNewOpen] = useState(false);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const showToast = useCallback(
    (kind: "ok" | "err", text: string, ms = 2500) => {
      setToast({ kind, text });
      window.setTimeout(() => setToast(null), ms);
    },
    [],
  );

  const handleFireTestEvent = useCallback(async () => {
    showToast(
      "ok",
      t("jobs.firingTestEvent", { defaultValue: "Firing test event…" }),
    );
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/automations/fire-test"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: {} }),
        },
      );
      if (!res.ok) {
        showToast(
          "err",
          t("jobs.fireEventError", {
            defaultValue: "Failed to fire event ({{status}})",
            status: res.status,
          }),
        );
        return;
      }
      showToast("ok", t("jobs.eventFired", { defaultValue: "Event fired" }));
    } catch (err: unknown) {
      showToast(
        "err",
        err instanceof Error
          ? err.message
          : t("jobs.fireEventErrorGeneric", {
              defaultValue: "Failed to fire event.",
            }),
      );
    }
  }, [showToast, t]);

  const handleNewSubmit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    window.dispatchEvent(
      new CustomEvent("agent-panel:set-mode", {
        detail: { mode: "chat" },
      }),
    );
    sendToAgentChat({
      message: trimmed,
      context: automationCreationContext(),
      submit: true,
      newTab: true,
    });
    setNewOpen(false);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Popover open={newOpen} onOpenChange={setNewOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
            >
              <IconPlus className="size-3.5" />
              {t("jobs.newAutomation", { defaultValue: "New automation" })}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="z-[260] w-[calc(100vw-24px)] max-w-[380px] p-3"
          >
            <p className="px-1 pb-2 text-sm font-semibold text-foreground">
              {t("jobs.newAutomation", { defaultValue: "New automation" })}
            </p>
            <PromptComposer
              autoFocus
              placeholder={t("jobs.automationPlaceholder", {
                defaultValue: "Describe what you want to automate…",
              })}
              draftScope="automations:create"
              onSubmit={handleNewSubmit}
            />
          </PopoverContent>
        </Popover>
        {automations.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={handleFireTestEvent}
          >
            <IconPlayerPlay className="size-3.5" />
            {t("jobs.fireTestEvent", { defaultValue: "Fire test event" })}
          </Button>
        ) : null}
      </div>
      {toast ? (
        <p
          className={
            toast.kind === "ok"
              ? "text-xs text-emerald-600"
              : "text-xs text-destructive"
          }
        >
          {toast.text}
        </p>
      ) : null}
      <AutomationsList
        scope="user"
        compact
        emptyMessage={t("jobs.automationsEmptySettings", {
          defaultValue:
            'No automations yet. Click "New automation" or ask the agent to set one up.',
        })}
      />
    </div>
  );
}
