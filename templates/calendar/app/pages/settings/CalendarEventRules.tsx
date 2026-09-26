import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";

interface EventRulesStatus {
  enabled: boolean;
  intervalMinutes: number | null;
  message: string | null;
  lastError: string | null;
  accountRefreshErrors: Array<{ email: string; error: string }>;
  conflictsSkipped: boolean;
  reason: string | null;
  registered: boolean;
}

/** Jev invitation rules: the accept, decline, and hide prompts plus recent activity. */
export function CalendarEventRulesFields() {
  const t = useT();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const eventRulesStatus = useActionQuery<EventRulesStatus>(
    "get-event-rules-status",
  );
  const undoEventRuleActivity = useActionMutation<
    { success: boolean; activityId: string },
    { activityId: string }
  >("undo-calendar-event-rule", {
    onSuccess: () => toast.success(t("settings.eventRuleUndoDone")),
    onError: (error) => {
      const code = (error as { errorCode?: unknown } | null)?.errorCode;
      const message =
        code === "conflict" ? undefined : actionErrorMessage(error);
      toast.error(message ?? t("settings.eventRuleUndoFailed"));
    },
  });
  const [eventRules, setEventRules] = useState({
    accept: "",
    decline: "",
    hide: "",
  });
  const eventRuleLabels = {
    accept: t("settings.eventRuleAccept"),
    decline: t("settings.eventRuleDecline"),
    hide: t("settings.eventRuleHide"),
  };
  const eventRulePlaceholders = {
    accept: t("settings.eventRulePlaceholderAccept"),
    decline: t("settings.eventRulePlaceholderDecline"),
    hide: t("settings.eventRulePlaceholderHide"),
  };
  const eventRuleActivityLabels = {
    accepted: t("settings.eventRuleActivityAccepted"),
    declined: t("settings.eventRuleActivityDeclined"),
    hidden: t("settings.eventRuleActivityHidden"),
  };

  useEffect(() => {
    if (!settings) return;
    const nextEventRules = {
      accept: settings.eventRules?.accept ?? "",
      decline: settings.eventRules?.decline ?? "",
      hide: settings.eventRules?.hide ?? "",
    };
    setEventRules((current) =>
      current.accept === nextEventRules.accept &&
      current.decline === nextEventRules.decline &&
      current.hide === nextEventRules.hide
        ? current
        : nextEventRules,
    );
  }, [settings]);

  function handleSaveRules() {
    updateSettings.mutate(
      { eventRules },
      {
        onSuccess: () => toast.success(t("settings.saved")),
        onError: () => toast.error(t("settings.saveFailed")),
      },
    );
  }

  const hasEventRules = Object.values(eventRules).some((rule) => rule.trim());
  const statusData = eventRulesStatus.data;
  const unavailableRulesMessage =
    statusData?.enabled === false && hasEventRules
      ? t(
          !statusData.registered
            ? "settings.eventRulesUnregistered"
            : statusData.reason === "disabled-by-env"
              ? "settings.eventRulesDeploymentDisabled"
              : "settings.eventRulesDisabled",
        )
      : null;
  const eventRulesStatusError = eventRulesStatus.isError
    ? t("common.loadFailed")
    : (statusData?.lastError ??
      (statusData?.conflictsSkipped
        ? t("settings.eventRulesConflict")
        : unavailableRulesMessage));

  return (
    <>
      {eventRulesStatusError ? (
        <p className="text-sm text-destructive" role="status">
          {eventRulesStatusError}
        </p>
      ) : null}
      {statusData?.accountRefreshErrors.map(({ email, error }) => (
        <p key={email} className="text-sm text-destructive" role="status">
          {email}: {error}
        </p>
      ))}
      {(["accept", "decline", "hide"] as const).map((rule) => (
        <div key={rule} className="space-y-2">
          <Label htmlFor={`event-rule-${rule}`}>{eventRuleLabels[rule]}</Label>
          <Textarea
            id={`event-rule-${rule}`}
            value={eventRules[rule]}
            onChange={(event) =>
              setEventRules((current) => ({
                ...current,
                [rule]: event.target.value,
              }))
            }
            placeholder={eventRulePlaceholders[rule]}
            maxLength={2000}
            rows={2}
          />
        </div>
      ))}
      <Button
        size="sm"
        onClick={handleSaveRules}
        disabled={updateSettings.isPending}
      >
        {t("settings.eventRulesSave")}
      </Button>
      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("settings.eventRulesRecentActivity")}
        </summary>
        {settings?.eventRuleActivity?.length ? (
          <ul className="mt-2 divide-y">
            {[...settings.eventRuleActivity].reverse().map((entry) => (
              <li
                key={entry.id}
                className="flex min-w-0 items-center gap-2 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {entry.title || t("eventForm.ai.untitledEvent")}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {eventRuleActivityLabels[entry.action]}
                </span>
                <time className="shrink-0 text-muted-foreground">
                  {new Date(entry.occurredAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2"
                  disabled={undoEventRuleActivity.isPending}
                  onClick={() =>
                    undoEventRuleActivity.mutate({
                      activityId: entry.id,
                    })
                  }
                >
                  {t("calendarView.undo")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("settings.eventRulesNoActivity")}
          </p>
        )}
      </details>
    </>
  );
}
