import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
} from "@agent-native/core/client/settings";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";

interface EventRulesStatus {
  jevConfigured: boolean;
  enabled: boolean;
  intervalMinutes: number | null;
  message: string | null;
  lastError: string | null;
  accountRefreshErrors: Array<{ email: string; error: string }>;
  conflictsSkipped: boolean;
  reason: string | null;
  registered: boolean;
}

const EMPTY_EVENT_RULES = { accept: "", decline: "", hide: "" };

/** Jev invitation rules: the accept, decline, and hide prompts, and a Recent activity tab. */
export function CalendarEventRules() {
  const t = useT();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const eventRulesStatus = useActionQuery<EventRulesStatus>(
    "get-event-rules-status",
    {},
    {
      staleTime: 0,
      // request-storm-allow: refresh this one capability query when API-key settings return from another tab.
      refetchOnWindowFocus: true,
    },
  );
  const jevConnectFlow = useBuilderConnectFlow({
    trackingSource: "calendar_jev_invitation_rules",
    trackingFlow: "connect_jev",
    onConnected: () => void eventRulesStatus.refetch(),
  });
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
  const [eventRules, setEventRules] = useState(EMPTY_EVENT_RULES);
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

  function handleClearSavedRules() {
    updateSettings.mutate(
      { eventRules: EMPTY_EVENT_RULES },
      {
        onSuccess: () => {
          setEventRules(EMPTY_EVENT_RULES);
          toast.success(t("settings.saved"));
        },
        onError: () => toast.error(t("settings.saveFailed")),
      },
    );
  }

  const hasEventRules = Object.values(eventRules).some((rule) => rule.trim());
  const hasSavedEventRules = Object.values(settings?.eventRules ?? {}).some(
    (rule) => rule?.trim(),
  );
  const statusData = eventRulesStatus.data;
  const statusReady = !eventRulesStatus.isLoading && !eventRulesStatus.isError;
  const jevConfigured = statusData?.jevConfigured === true;
  const canEditEventRules = statusReady && jevConfigured;
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
  const eventRulesStatusError =
    statusData?.lastError ??
    (statusData?.conflictsSkipped
      ? t("settings.eventRulesConflict")
      : unavailableRulesMessage);

  return (
    <Tabs defaultValue="rules">
      <div className="flex items-center gap-2">
        <TabsList
          aria-label={t("settings.eventRules")}
          className="grid flex-1 grid-cols-2"
        >
          <TabsTrigger value="rules">
            {t("settings.eventRulesTabRules")}
          </TabsTrigger>
          <TabsTrigger value="activity">
            {t("settings.eventRulesRecentActivity")}
          </TabsTrigger>
        </TabsList>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label={t("settings.eventRulesHelpLabel")}
              >
                <IconInfoCircle className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {t("settings.eventRulesHelp")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <TabsContent value="rules" className="mt-4">
        <div className="space-y-4">
          {eventRulesStatus.isError ? (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-3 py-2"
              role="alert"
            >
              <span className="text-sm text-muted-foreground">
                {t("common.loadFailed")}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={eventRulesStatus.isFetching}
                onClick={() => void eventRulesStatus.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : eventRulesStatusError ? (
            <p className="text-sm text-destructive" role="status">
              {eventRulesStatusError}
            </p>
          ) : null}
          {statusReady && !jevConfigured ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("settings.eventRulesConnectJev")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.eventRulesFreeBuilderOrApiKey")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <BuilderConnectPopover flow={jevConnectFlow}>
                  <Button
                    type="button"
                    size="sm"
                    disabled={jevConnectFlow.connecting}
                    aria-busy={jevConnectFlow.connecting}
                  >
                    {jevConnectFlow.connecting
                      ? t("common.connecting")
                      : t("settings.eventRulesConnectBuilder")}
                  </Button>
                </BuilderConnectPopover>
                <Link
                  to={buildSettingsRoute("keys:secrets:JEV_API_KEY")}
                  target="_blank"
                  rel="noreferrer"
                  className="whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t("settings.eventRulesAddJevApiKey")}
                </Link>
              </div>
            </div>
          ) : null}
          {statusData?.accountRefreshErrors.map(({ email, error }) => (
            <p key={email} className="text-sm text-destructive" role="status">
              {email}: {error}
            </p>
          ))}
          {eventRulesStatus.isLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            (["accept", "decline", "hide"] as const).map((rule) => (
              <div key={rule} className="space-y-2">
                <Label htmlFor={`event-rule-${rule}`}>
                  {eventRuleLabels[rule]}
                </Label>
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
                  disabled={!canEditEventRules}
                />
              </div>
            ))
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={handleSaveRules}
              disabled={updateSettings.isPending || !canEditEventRules}
            >
              {t("settings.eventRulesSave")}
            </Button>
            {statusReady && !jevConfigured && hasSavedEventRules ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearSavedRules}
                disabled={updateSettings.isPending}
              >
                {t("settings.eventRulesClearSaved")}
              </Button>
            ) : null}
          </div>
        </div>
      </TabsContent>
      <TabsContent value="activity">
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
                  className="shrink-0"
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
      </TabsContent>
    </Tabs>
  );
}
