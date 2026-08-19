import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type TriageConfig = {
  slackWorkspace?: "primary" | "secondary";
  slackChannelId?: string | null;
  slackChannelName?: string | null;
  builderSlackUserId?: string | null;
  pollingEnabled?: boolean;
  githubPollingEnabled?: boolean;
  sentryPollingEnabled?: boolean;
  sentryOrgSlug?: string | null;
  sentryProjectSlug?: string | null;
  sentryEnvironment?: string | null;
  repository?: string | null;
  automationFailureAlertsEnabled?: boolean;
  automationFailureAlertEmail?: string | null;
  emailReadiness?: {
    status: "ready" | "not-configured" | "misconfigured" | "unavailable";
    provider: string;
  };
};

type FactoryAutomationHealth = {
  status: "healthy" | "stale" | "error" | "no-data";
  lastCheckedAt?: number | null;
  lastDispatchedAt?: number | null;
  lastError?: string | null;
  runtime?: string | null;
};

function formatAutomationDate(value: string | number | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function FactorySettingsView() {
  const t = useT();
  const [workspace, setWorkspace] = useState<"primary" | "secondary">(
    "primary",
  );
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [builderSlackUserId, setBuilderSlackUserId] = useState("");
  const [repository, setRepository] = useState("");
  const [polling, setPolling] = useState(false);
  const [githubPolling, setGithubPolling] = useState(false);
  const [sentryPolling, setSentryPolling] = useState(false);
  const [sentryOrgSlug, setSentryOrgSlug] = useState("");
  const [sentryProjectSlug, setSentryProjectSlug] = useState("");
  const [sentryEnvironment, setSentryEnvironment] = useState("");
  const [automationFailureAlertsEnabled, setAutomationFailureAlertsEnabled] =
    useState(true);
  const [automationFailureAlertEmail, setAutomationFailureAlertEmail] =
    useState("");
  const query = useActionQuery("get-triage-config", {});
  const schedulerHealthQuery = useActionQuery<FactoryAutomationHealth>(
    "get-factory-automation-health",
    {},
    { refetchInterval: 60_000 },
  );
  const mutation = useActionMutation("save-triage-config");

  useEffect(() => {
    const data = query.data as TriageConfig | undefined;
    if (!data) return;
    setWorkspace(data.slackWorkspace ?? "primary");
    setChannelId(data.slackChannelId ?? "");
    setChannelName(data.slackChannelName ?? "");
    setBuilderSlackUserId(data.builderSlackUserId ?? "");
    setRepository(data.repository ?? "");
    setPolling(data.pollingEnabled ?? false);
    setGithubPolling(data.githubPollingEnabled ?? false);
    setSentryPolling(data.sentryPollingEnabled ?? false);
    setSentryOrgSlug(data.sentryOrgSlug ?? "");
    setSentryProjectSlug(data.sentryProjectSlug ?? "");
    setSentryEnvironment(data.sentryEnvironment ?? "");
    setAutomationFailureAlertsEnabled(
      data.automationFailureAlertsEnabled ?? true,
    );
    setAutomationFailureAlertEmail(data.automationFailureAlertEmail ?? "");
  }, [query.data]);

  const saveSettings = async () => {
    try {
      await mutation.mutateAsync({
        slackWorkspace: workspace,
        slackChannelId: channelId,
        slackChannelName: channelName,
        builderSlackUserId,
        repository,
        pollingEnabled: polling,
        githubPollingEnabled: githubPolling,
        sentryPollingEnabled: sentryPolling,
        sentryOrgSlug,
        sentryProjectSlug,
        sentryEnvironment,
        automationFailureAlertsEnabled,
        ...(automationFailureAlertEmail.trim()
          ? { automationFailureAlertEmail: automationFailureAlertEmail.trim() }
          : {}),
      });
      toast.success(t("triage.settingsSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("triage.settingsError"),
      );
    }
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
        <FactorySettingsSkeleton t={t} />
      </div>
    );
  }

  const fieldControlClass = "h-9 w-full sm:w-64";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
      <SettingsGroup variant="soft">
        <SettingsRow
          label={t("factoryRoute.workspaceIntegrations")}
          description={t("settings.workspaceDescription")}
          control={
            <Button asChild type="button" variant="outline">
              <Link to={buildSettingsRoute("integrations")}>Manage</Link>
            </Button>
          }
        />
        <SettingsRow
          label={t("factoryRoute.agentAccess")}
          description={t("settings.agentDescription")}
          control={
            <Button asChild type="button" variant="outline">
              <Link to={buildSettingsRoute("agent")}>Manage</Link>
            </Button>
          }
        />
      </SettingsGroup>

      <SettingsGroup variant="soft">
        <SettingsRow
          label={t("triage.slackWorkspace")}
          control={
            <select
              aria-label={t("triage.slackWorkspace")}
              value={workspace}
              onChange={(event) =>
                setWorkspace(event.target.value as "primary" | "secondary")
              }
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64"
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
          }
        />
        <SettingsRow
          label={t("triage.slackChannelId")}
          control={
            <Input
              aria-label={t("triage.slackChannelId")}
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder={t("triage.slackChannelPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.slackChannelName")}
          control={
            <Input
              aria-label={t("triage.slackChannelName")}
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              placeholder={t("triage.slackChannelNamePlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.builderSlackUserId")}
          control={
            <Input
              aria-label={t("triage.builderSlackUserId")}
              value={builderSlackUserId}
              onChange={(event) => setBuilderSlackUserId(event.target.value)}
              placeholder={t("triage.builderSlackUserIdPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.repository")}
          control={
            <Input
              aria-label={t("triage.repository")}
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder={t("triage.repositoryPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.enablePolling")}
          control={
            <Switch
              aria-label={t("triage.enablePolling")}
              checked={polling}
              onCheckedChange={(checked) => setPolling(checked === true)}
            />
          }
        />
        <SettingsRow
          label={t("triage.enableGithubPolling")}
          control={
            <Switch
              aria-label={t("triage.enableGithubPolling")}
              checked={githubPolling}
              onCheckedChange={(checked) => setGithubPolling(checked === true)}
            />
          }
        />
        <SettingsRow
          label={t("triage.sentryOrgSlug")}
          control={
            <Input
              aria-label={t("triage.sentryOrgSlug")}
              value={sentryOrgSlug}
              onChange={(event) => setSentryOrgSlug(event.target.value)}
              placeholder={t("triage.sentryOrgPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.sentryProjectSlug")}
          control={
            <Input
              aria-label={t("triage.sentryProjectSlug")}
              value={sentryProjectSlug}
              onChange={(event) => setSentryProjectSlug(event.target.value)}
              placeholder={t("triage.sentryProjectPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.sentryEnvironment")}
          control={
            <Input
              aria-label={t("triage.sentryEnvironment")}
              value={sentryEnvironment}
              onChange={(event) => setSentryEnvironment(event.target.value)}
              placeholder={t("triage.sentryEnvironmentPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.enableSentryPolling")}
          control={
            <Switch
              aria-label={t("triage.enableSentryPolling")}
              checked={sentryPolling}
              onCheckedChange={(checked) => setSentryPolling(checked === true)}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup variant="soft">
        <SettingsRow
          label={t("factoryRoute.automationFailureAlertsTitle")}
          description={t("factoryRoute.automationFailureAlertsDescription")}
          control={
            <Switch
              aria-label={t("factoryRoute.automationFailureAlertsEnabled")}
              checked={automationFailureAlertsEnabled}
              onCheckedChange={(checked) =>
                setAutomationFailureAlertsEnabled(checked === true)
              }
            />
          }
        />
        <SettingsRow
          label={t("factoryRoute.automationFailureAlertEmail")}
          description={t("factoryRoute.automationFailureAlertEmailPlaceholder")}
          control={
            <Input
              aria-label={t("factoryRoute.automationFailureAlertEmail")}
              type="email"
              value={automationFailureAlertEmail}
              onChange={(event) =>
                setAutomationFailureAlertEmail(event.target.value)
              }
              placeholder={t(
                "factoryRoute.automationFailureAlertEmailPlaceholder",
              )}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("factoryRoute.automationFailureEmailReadiness")}
          description={t("factoryRoute.automationEmailReadinessHint")}
          control={
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {(query.data as TriageConfig | undefined)?.emailReadiness
                ?.status ?? "unknown"}
            </span>
          }
        />
        {query.isError && (
          <div className="px-5 py-3 text-xs text-destructive sm:px-6">
            {t("factoryRoute.automationDiagnosticsLoadError")}{" "}
            {query.error instanceof Error
              ? query.error.message
              : String(query.error)}
          </div>
        )}
      </SettingsGroup>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          onClick={() => void saveSettings()}
          disabled={mutation.isPending}
        >
          {mutation.isPending && <IconLoader2 className="animate-spin" />}
          {t("triage.saveSettings")}
        </Button>
      </div>

      <SchedulerHealthStatus
        health={schedulerHealthQuery.data}
        isError={schedulerHealthQuery.isError}
        error={schedulerHealthQuery.error}
        t={t}
      />
    </div>
  );
}

function FactorySettingsSkeleton({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <div className="space-y-6" aria-label={t("triage.loading")}>
      {[2, 11, 3].map((rowCount, index) => (
        <div key={index} className="grid gap-2">
          <div className="grid gap-2">
            {Array.from({ length: rowCount }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex min-h-20 items-center justify-between gap-4 rounded-xl bg-card px-5 py-4 shadow-sm sm:px-6"
              >
                <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
                <div className="h-9 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SchedulerHealthStatus({
  health,
  isError,
  error,
  t,
}: {
  health?: FactoryAutomationHealth;
  isError: boolean;
  error: unknown;
  t: ReturnType<typeof useT>;
}) {
  const healthLabel = isError
    ? t("factoryRoute.automationHealthError")
    : health
      ? {
          healthy: t("factoryRoute.automationHealthHealthy"),
          stale: t("factoryRoute.automationHealthStale"),
          error: t("factoryRoute.automationHealthError"),
          "no-data": t("factoryRoute.automationHealthNoData"),
        }[health.status]
      : t("factoryRoute.automationHealthNoData");
  const hasNoHeartbeat =
    !isError &&
    (!health || health.status === "no-data") &&
    !health?.lastCheckedAt;
  const healthDescription = isError
    ? `${t("factoryRoute.automationDiagnosticsLoadError")} ${error instanceof Error ? error.message : String(error)}`
    : health?.lastError
      ? `${t("factoryRoute.automationHealthErrorDetail")}: ${health.lastError}`
      : health?.status === "stale"
        ? t("factoryRoute.automationHealthStaleHint")
        : hasNoHeartbeat
          ? t("factoryRoute.automationHealthNoDataHint")
          : undefined;

  return (
    <SettingsGroup variant="soft">
      <SettingsRow
        label={t("factoryRoute.automationHealthTitle")}
        description={
          healthDescription ?? t("factoryRoute.automationHealthDescription")
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {healthLabel}
            </span>
            {health?.lastCheckedAt && (
              <span className="text-xs text-muted-foreground">
                {t("factoryRoute.automationLastCheck")}:{" "}
                {formatAutomationDate(health.lastCheckedAt)}
              </span>
            )}
            {health?.lastDispatchedAt && (
              <span className="text-xs text-muted-foreground">
                {t("factoryRoute.automationLastDispatch")}:{" "}
                {formatAutomationDate(health.lastDispatchedAt)}
              </span>
            )}
          </div>
        }
      />
    </SettingsGroup>
  );
}
