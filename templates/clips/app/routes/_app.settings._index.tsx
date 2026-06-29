import {
  useSession,
  agentNativePath,
  appApiPath,
  LanguagePicker,
  useActionQuery,
  useBuilderConnectFlow,
  useBuilderStatus,
  ChangelogSettingsCard,
  SettingsTabsPage,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import {
  BUILDER_CREDITS_UPGRADE_URL,
  type BuilderCreditsStatus,
} from "@shared/builder-credits";
import {
  IconBrain,
  IconBolt,
  IconBrandSlack,
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconServer,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/library/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import enMessages from "@/i18n/en-US";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: enMessages.settings.pageTitle }];
}

const SPEEDS = ["1", "1.2", "1.5", "1.75", "2"];

const BUILDER_CREDITS_FEATURE_LABELS = [
  "builderCredits.featureBackupTranscription",
  "builderCredits.featureCleanup",
  "builderCredits.featureSummaries",
  "builderCredits.featureTitles",
] as const;

const S3_STORAGE_FIELDS = [
  {
    key: "S3_ENDPOINT",
    labelKey: "settings.s3EndpointLabel",
    placeholder: "https://s3.us-east-1.amazonaws.com",
    required: true,
  },
  {
    key: "S3_BUCKET",
    labelKey: "settings.s3BucketLabel",
    placeholder: "my-clips-bucket",
    required: true,
  },
  {
    key: "S3_ACCESS_KEY_ID",
    labelKey: "settings.s3AccessKeyLabel",
    placeholder: "AKIA...",
    required: true,
  },
  {
    key: "S3_SECRET_ACCESS_KEY",
    labelKey: "settings.s3SecretAccessKeyLabel",
    placeholder: "••••••••",
    required: true,
    secret: true,
  },
  {
    key: "S3_REGION",
    labelKey: "settings.s3RegionLabel",
    placeholder: "us-east-1",
  },
  {
    key: "S3_PUBLIC_BASE_URL",
    labelKey: "settings.s3PublicBaseUrlLabel",
    placeholder: "https://cdn.example.com",
  },
] as const;

const AI_PROVIDER_FIELDS = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    storage: "agent-engine",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI",
    placeholder: "sk-...",
    storage: "agent-engine",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Gemini",
    placeholder: "AI...",
    storage: "secret",
  },
  {
    key: "GROQ_API_KEY",
    label: "Groq",
    placeholder: "gsk_...",
    storage: "secret",
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    storage: "agent-engine",
  },
] as const;

interface ClipsUserSettings {
  defaultPlaybackSpeed?: string;
  emailNotifications?: boolean;
  displayName?: string;
  transcriptCleanupEnabled?: boolean;
}

interface SlackInstallation {
  id: string;
  teamId: string;
  teamName: string | null;
  enterpriseName: string | null;
  apiAppId: string | null;
  ownerEmail: string;
  orgId: string | null;
  status: string;
  updatedAt: string;
}

interface SlackInstallationsResponse {
  oauthConfigured: boolean;
  signingConfigured: boolean;
  scopes: string[];
  installations: SlackInstallation[];
}

async function loadSettings(): Promise<ClipsUserSettings> {
  try {
    const res = await fetch(
      agentNativePath("/_agent-native/settings/clips-user-prefs"),
    );
    if (!res.ok) return {};
    const json = await res.json();
    // The store's GET returns the stored object directly, not wrapped.
    if (json && typeof json === "object" && !("error" in json)) {
      return json as ClipsUserSettings;
    }
    return {};
  } catch {
    return {};
  }
}

async function saveSettings(value: ClipsUserSettings): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/settings/clips-user-prefs"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
  );
  if (!res.ok) {
    throw new Error(`Save failed (${res.status})`);
  }
}

function absoluteAppUrl(url: string): string {
  const withBase = url.startsWith("/api/") ? appApiPath(url) : url;
  return new URL(withBase, window.location.origin).toString();
}

async function waitForPopupClose(popup: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
      resolve();
    };
    const interval = window.setInterval(() => {
      if (popup.closed) finish();
    }, 500);
    const onFocus = () => {
      if (popup.closed) finish();
    };
    window.addEventListener("focus", onFocus);
    const timeout = window.setTimeout(finish, 5 * 60 * 1000);
  });
}

async function startSlackOAuth(): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/connect-slack?returnUrl=/settings"),
  );
  const text = await res.text();
  let data: {
    url?: string;
    error?: string;
    result?: { url?: string };
  } = {};
  try {
    data = JSON.parse(text);
  } catch {
    // Keep the fallback below.
  }
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  const url = data.result?.url ?? data.url;
  if (!url) throw new Error("No Slack OAuth URL returned");
  const popup = window.open(
    absoluteAppUrl(url),
    "clips-slack-oauth",
    "width=600,height=760",
  );
  if (!popup) {
    throw new Error(
      "Popup blocked — please allow popups for this site and try again.",
    );
  }
  await waitForPopupClose(popup);
}

async function requestDisconnectSlack(id: string): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/disconnect-slack"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Disconnect failed (${res.status})`);
  }
}

async function saveS3StorageSettings(
  values: Record<string, string>,
): Promise<void> {
  const vars = S3_STORAGE_FIELDS.map((field) => ({
    key: field.key,
    value: (values[field.key] ?? "").trim(),
  })).filter((entry) => entry.value.length > 0);

  if (vars.length === 0) {
    throw new Error("Enter at least one storage value.");
  }

  for (const { key, value } of vars) {
    const res = await fetch(agentNativePath("/_agent-native/secrets/adhoc"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: key,
        value,
        scope: "workspace",
        description: "Clips S3-compatible storage", // i18n-ignore -- secret metadata description, not visible UI
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? `Save failed (${res.status})`);
    }
  }
}

async function saveAgentEngineApiKey(
  key: string,
  value: string,
): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/agent-engine/api-key"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, scope: "user" }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Save failed (${res.status})`);
  }
}

async function saveRegisteredSecret(key: string, value: string): Promise<void> {
  const res = await fetch(
    agentNativePath(`/_agent-native/secrets/${encodeURIComponent(key)}`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Save failed (${res.status})`);
  }
}

export default function SettingsIndexRoute() {
  const { session } = useSession();
  const t = useT();
  const email = session?.email ?? "";
  const storageStatus = useVideoStorageStatus();
  const builderStatus = useBuilderStatus();
  const builderConnect = useBuilderConnectFlow({
    popupUrl:
      builderStatus.status?.cliAuthUrl ?? builderStatus.status?.connectUrl,
    trackingSource: "clips_settings",
    trackingFlow: "clips_setup",
    onConnected: async () => {
      await Promise.all([storageStatus.refetch(), builderStatus.refetch()]);
      toast.success(t("settings.builderConnectedToast"));
    },
  });
  const slackStatus = useActionQuery<SlackInstallationsResponse>(
    "list-slack-installations",
    undefined,
    { retry: false },
  );
  const builderCreditStatus = useActionQuery<BuilderCreditsStatus>(
    "get-builder-credit-status",
    undefined,
    { retry: false },
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingStorage, setSavingStorage] = useState(false);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [disconnectingSlack, setDisconnectingSlack] = useState(false);
  const [disconnectSlackTarget, setDisconnectSlackTarget] =
    useState<SlackInstallation | null>(null);
  const [defaultSpeed, setDefaultSpeed] = useState("1.2");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [transcriptCleanupEnabled, setTranscriptCleanupEnabled] =
    useState(true);
  const [s3Values, setS3Values] = useState<Record<string, string>>({});
  const [s3Expanded, setS3Expanded] = useState(false);
  const [apiKeysExpanded, setApiKeysExpanded] = useState(false);
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({});
  const [apiKeyStatusLoading, setApiKeyStatusLoading] = useState(true);
  const [savingApiKey, setSavingApiKey] = useState<string | null>(null);

  const refreshApiKeyStatus = useCallback(async () => {
    setApiKeyStatusLoading(true);
    try {
      const [envRes, secretsRes] = await Promise.all([
        fetch(agentNativePath("/_agent-native/env-status")),
        fetch(agentNativePath("/_agent-native/secrets")),
      ]);
      const envData = envRes.ok
        ? ((await envRes.json()) as Array<{
            key: string;
            configured?: boolean;
          }>)
        : [];
      const secretsData = secretsRes.ok
        ? ((await secretsRes.json()) as Array<{
            key: string;
            status?: string;
          }>)
        : [];
      const next = Object.fromEntries(
        envData.map((entry) => [entry.key, Boolean(entry.configured)]),
      );
      for (const entry of secretsData) {
        next[entry.key] = entry.status === "set";
      }
      setApiKeyStatus(next);
    } catch {
      setApiKeyStatus({});
    } finally {
      setApiKeyStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((v) => {
      if (cancelled) return;
      setDefaultSpeed(v.defaultPlaybackSpeed ?? "1.2");
      setEmailNotifications(v.emailNotifications ?? true);
      setDisplayName(v.displayName ?? "");
      setTranscriptCleanupEnabled(v.transcriptCleanupEnabled !== false);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshApiKeyStatus();
  }, [refreshApiKeyStatus]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveSettings({
        defaultPlaybackSpeed: defaultSpeed,
        emailNotifications,
        displayName: displayName.trim() || undefined,
        transcriptCleanupEnabled,
      });
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveS3Storage() {
    const s3Configured = storageStatus.data?.activeProvider?.id === "s3";
    const missing = s3Configured
      ? []
      : S3_STORAGE_FIELDS.filter(
          (field) =>
            "required" in field &&
            field.required &&
            !(s3Values[field.key] ?? "").trim(),
        );
    if (missing.length > 0) {
      toast.error(t("settings.storageRequired"));
      return;
    }

    setSavingStorage(true);
    try {
      await saveS3StorageSettings(s3Values);
      setS3Values((current) => ({
        ...current,
        S3_SECRET_ACCESS_KEY: "",
      }));
      await storageStatus.refetch();
      toast.success(t("settings.storageSaved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.saveFailed"),
      );
    } finally {
      setSavingStorage(false);
    }
  }

  async function handleSaveApiKey(key: string) {
    const value = (apiKeyValues[key] ?? "").trim();
    if (!value) {
      toast.error(t("settings.pasteProviderKey"));
      return;
    }

    setSavingApiKey(key);
    try {
      const field = AI_PROVIDER_FIELDS.find((item) => item.key === key);
      if (field?.storage === "secret") {
        await saveRegisteredSecret(key, value);
      } else {
        await saveAgentEngineApiKey(key, value);
      }
      setApiKeyValues((current) => ({ ...current, [key]: "" }));
      setApiKeyStatus((current) => ({ ...current, [key]: true }));
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
      await refreshApiKeyStatus();
      toast.success(t("settings.apiKeySaved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.apiKeyFailed"),
      );
    } finally {
      setSavingApiKey(null);
    }
  }

  async function handleConnectSlack() {
    const beforeCount = slackInstallations.length;
    setConnectingSlack(true);
    try {
      await startSlackOAuth();
      const refreshed = await slackStatus.refetch();
      const afterCount = refreshed.data?.installations?.length ?? beforeCount;
      if (afterCount > beforeCount) {
        toast.success(t("settings.slackConnectedToast"));
      } else {
        toast.message(t("settings.slackCheckedToast"));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.slackConnectFailed"),
      );
    } finally {
      setConnectingSlack(false);
    }
  }

  async function handleDisconnectSlack() {
    const target = disconnectSlackTarget;
    if (!target) return;
    setDisconnectingSlack(true);
    try {
      await requestDisconnectSlack(target.id);
      setDisconnectSlackTarget(null);
      await slackStatus.refetch();
      toast.success(t("settings.slackDisconnectedToast"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("settings.slackDisconnectFailed"),
      );
    } finally {
      setDisconnectingSlack(false);
    }
  }

  const storageConfigured = !!storageStatus.data?.configured;
  const activeProviderName = storageStatus.data?.activeProvider?.name ?? null;
  const activeProviderId = storageStatus.data?.activeProvider?.id ?? null;
  const builderConnected = Boolean(
    builderConnect.configured ||
    builderStatus.status?.configured ||
    storageStatus.data?.builderConfigured ||
    activeProviderId === "builder",
  );
  const builderOrgName =
    builderConnect.orgName ?? builderStatus.status?.orgName ?? null;
  const builderStatusLoading =
    storageStatus.isLoading ||
    builderStatus.loading ||
    !builderConnect.hasFetchedStatus;
  const s3Configured = activeProviderId === "s3";
  const s3Collapsed = builderConnected && !s3Expanded;
  const configuredApiKeyCount = AI_PROVIDER_FIELDS.filter(
    (field) => apiKeyStatus[field.key],
  ).length;
  const slackInstallations = slackStatus.data?.installations ?? [];
  const slackOauthConfigured = slackStatus.data?.oauthConfigured ?? false;
  const slackSigningConfigured = slackStatus.data?.signingConfigured ?? false;
  const slackConnected = slackInstallations.length > 0;
  const localizedChangelog = t("settings.changelogMarkdown");
  const builderCreditsPaused = builderCreditStatus.data?.exhausted === true;
  const builderCreditsUpgradeUrl =
    builderCreditStatus.data?.upgradeUrl ?? BUILDER_CREDITS_UPGRADE_URL;

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {t("settings.title")}
        </h1>
      </PageHeader>
      <SettingsTabsPage
        whatsNewLabel={t("settings.whatsNew")}
        general={
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <div className="min-w-0 space-y-6">
              <p className="text-sm text-muted-foreground">
                {t("settings.intro")}
              </p>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("settings.languageTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.languageDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="max-w-xs space-y-1.5">
                  <Label>{t("settings.languageLabel")}</Label>
                  <LanguagePicker label={t("settings.languageLabel")} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("settings.agentTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.agentDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" onClick={() => openAgentSettings()}>
                    {t("settings.openAgentSettings")}
                  </Button>
                </CardContent>
              </Card>

              <Card id="video-storage" className="scroll-mt-16">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <IconCloud className="size-4 text-primary" />
                    {t("settings.videoStorage")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.videoStorageDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    className={cn(
                      "flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                      builderConnected
                        ? "border-primary/35 bg-primary/5"
                        : "border-border bg-accent/30",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {builderConnected ? (
                          <IconCheck className="h-4 w-4 text-primary" />
                        ) : (
                          <IconKey className="h-4 w-4 text-muted-foreground" />
                        )}
                        {builderStatusLoading
                          ? t("settings.checkingBuilder")
                          : builderConnected
                            ? t("settings.builderConnected")
                            : t("settings.connectBuilder")}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {builderConnected
                          ? builderOrgName
                            ? t("settings.builderConnectedFor", {
                                orgName: builderOrgName,
                              })
                            : t("settings.builderConnectedGeneric")
                          : t("settings.builderIncludes")}
                      </p>
                    </div>
                    {builderConnected ? (
                      <Badge variant="secondary" className="shrink-0">
                        {t("common.connected")}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          builderConnect.start({
                            trackingSource: "clips_settings_video_storage",
                            trackingFlow: "video_storage",
                          })
                        }
                        disabled={
                          builderConnect.connecting || builderStatusLoading
                        }
                      >
                        {builderConnect.connecting ? (
                          <IconLoader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <IconExternalLink className="h-4 w-4" />
                        )}
                        {t("settings.connectBuilder")}
                      </Button>
                    )}
                  </div>

                  <Collapsible
                    open={builderConnected ? !s3Collapsed : true}
                    onOpenChange={(open) => setS3Expanded(open)}
                  >
                    <div className="rounded-md border border-border">
                      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <IconServer className="h-4 w-4 text-muted-foreground" />
                            {t("settings.s3Title")}
                            <Badge variant="outline" className="text-[10px]">
                              {t("settings.secondary")}
                            </Badge>
                            {s3Configured ? (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {t("settings.active")}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {builderConnected
                              ? t("settings.s3BuilderConnectedDescription")
                              : storageConfigured && activeProviderName
                                ? t("settings.s3CurrentProvider", {
                                    providerName: activeProviderName,
                                  })
                                : t("settings.s3OwnBucketDescription")}
                          </p>
                        </div>
                        {builderConnected ? (
                          <CollapsibleTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                            >
                              {s3Collapsed
                                ? t("settings.configureS3")
                                : t("settings.hideS3")}
                              <IconChevronDown
                                className={cn(
                                  "h-4 w-4 transition-transform",
                                  !s3Collapsed && "rotate-180",
                                )}
                              />
                            </Button>
                          </CollapsibleTrigger>
                        ) : null}
                      </div>

                      <CollapsibleContent>
                        <div className="space-y-4 border-t border-border px-3 py-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            {S3_STORAGE_FIELDS.map((field) => (
                              <div key={field.key} className="space-y-1.5">
                                <Label htmlFor={field.key}>
                                  {t(field.labelKey)}
                                </Label>
                                <Input
                                  id={field.key}
                                  type={
                                    "secret" in field && field.secret
                                      ? "password"
                                      : "text"
                                  }
                                  value={s3Values[field.key] ?? ""}
                                  onChange={(event) =>
                                    setS3Values((current) => ({
                                      ...current,
                                      [field.key]: event.target.value,
                                    }))
                                  }
                                  placeholder={field.placeholder}
                                  autoComplete="off"
                                  disabled={savingStorage}
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-end">
                            <Button
                              onClick={handleSaveS3Storage}
                              disabled={
                                savingStorage || storageStatus.isLoading
                              }
                            >
                              {savingStorage && (
                                <IconLoader2 className="h-4 w-4 animate-spin" />
                              )}
                              {t("settings.saveStorage")}
                            </Button>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </CardContent>
              </Card>

              <Card id="slack" className="scroll-mt-16">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <IconBrandSlack className="size-4 text-primary" />
                    {t("settings.slackTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.slackDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-md border border-border bg-accent/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <IconBrandSlack className="h-4 w-4 text-muted-foreground" />
                        {slackStatus.isLoading
                          ? t("settings.checkingSlack")
                          : slackConnected
                            ? t("settings.slackConnected", {
                                count: slackInstallations.length,
                              })
                            : slackOauthConfigured
                              ? t("common.notConnected")
                              : t("settings.slackOauthNeeded")}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("settings.slackPreviewDescription")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleConnectSlack}
                      disabled={
                        connectingSlack ||
                        slackStatus.isLoading ||
                        !slackOauthConfigured
                      }
                    >
                      {connectingSlack ? (
                        <IconLoader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <IconExternalLink className="h-4 w-4" />
                      )}
                      {t("settings.connectSlack")}
                    </Button>
                  </div>

                  {!slackOauthConfigured ? (
                    <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                      {t("settings.slackClientMissing")}
                    </div>
                  ) : null}

                  {!slackSigningConfigured ? (
                    <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                      {t("settings.slackSigningMissing")}
                    </div>
                  ) : null}

                  {slackInstallations.length > 0 ? (
                    <div className="space-y-2">
                      {slackInstallations.map((installation) => (
                        <div
                          key={installation.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {installation.teamName || installation.teamId}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span>{installation.status}</span>
                              {installation.enterpriseName ? (
                                <span>{installation.enterpriseName}</span>
                              ) : null}
                              <span>
                                {t("settings.connectedBy", {
                                  email: installation.ownerEmail,
                                })}
                              </span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            aria-label={t("settings.disconnectSlackLabel", {
                              team:
                                installation.teamName || installation.teamId,
                            })}
                            onClick={() =>
                              setDisconnectSlackTarget(installation)
                            }
                          >
                            <IconTrash className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card id="ai-providers" className="scroll-mt-16">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <IconBrain className="size-4 text-primary" />
                    {t("settings.apiSetup")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.apiSetupDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    className={cn(
                      "flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                      builderConnected
                        ? "border-primary/35 bg-primary/5"
                        : "border-border bg-accent/30",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {builderConnected ? (
                          <IconCheck className="h-4 w-4 text-primary" />
                        ) : (
                          <IconKey className="h-4 w-4 text-muted-foreground" />
                        )}
                        {builderStatusLoading
                          ? t("settings.checkingBuilder")
                          : builderConnected
                            ? t("settings.builderConnected")
                            : t("settings.builderEasySetup")}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {builderConnected
                          ? t("settings.builderAiAvailable")
                          : t("settings.builderAiDescription")}
                      </p>
                    </div>
                    {builderConnected ? (
                      <Badge variant="secondary" className="shrink-0">
                        {t("common.connected")}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          builderConnect.start({
                            trackingSource: "clips_settings_ai_setup",
                            trackingFlow: "connect_llm",
                          })
                        }
                        disabled={
                          builderConnect.connecting || builderStatusLoading
                        }
                      >
                        {builderConnect.connecting ? (
                          <IconLoader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <IconExternalLink className="h-4 w-4" />
                        )}
                        {t("settings.connectBuilder")}
                      </Button>
                    )}
                  </div>

                  {builderCreditsPaused ? (
                    <div className="rounded-md border border-amber-300/70 bg-amber-50/80 p-3 text-amber-950 shadow-sm dark:border-amber-400/30 dark:bg-amber-950/25 dark:text-amber-100">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <span className="rounded-md bg-amber-100 p-1 dark:bg-amber-400/15">
                              <IconBolt className="h-4 w-4 text-amber-700 dark:text-amber-200" />
                            </span>
                            {t("builderCredits.pausedTitle")}
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                            {t("builderCredits.settingsDescription")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {BUILDER_CREDITS_FEATURE_LABELS.map((key) => (
                              <span
                                key={key}
                                className="rounded-full border border-amber-300/70 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100"
                              >
                                {t(key)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button asChild size="sm" className="h-8">
                            <a
                              href={builderCreditsUpgradeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <IconExternalLink className="h-4 w-4" />
                              {t("builderCredits.upgrade")}
                            </a>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 border-amber-300/80 bg-white/70 text-amber-950 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
                            onClick={() => setApiKeysExpanded(true)}
                          >
                            {t("builderCredits.openAiSetup")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <Collapsible
                    open={apiKeysExpanded}
                    onOpenChange={setApiKeysExpanded}
                  >
                    <div className="rounded-md border border-border">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-start"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <IconKey className="h-4 w-4 text-muted-foreground" />
                              {t("settings.providerKeyTitle")}
                              {configuredApiKeyCount > 0 ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {t("settings.providerKeysSet", {
                                    count: configuredApiKeyCount,
                                  })}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {t("settings.providerKeyDescription")}
                            </p>
                          </div>
                          <IconChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                              apiKeysExpanded && "rotate-180",
                            )}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-3 border-t border-border px-3 py-4">
                          {apiKeyStatusLoading ? (
                            <div className="text-xs text-muted-foreground">
                              {t("settings.checkingProviderKeys")}
                            </div>
                          ) : null}
                          <div className="grid gap-3 sm:grid-cols-2">
                            {AI_PROVIDER_FIELDS.map((field) => {
                              const configured = Boolean(
                                apiKeyStatus[field.key],
                              );
                              const savingThisKey = savingApiKey === field.key;
                              return (
                                <div key={field.key} className="space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <Label htmlFor={field.key}>
                                      {field.label}
                                    </Label>
                                    {configured ? (
                                      <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                                        <IconCheck className="h-3 w-3" />
                                        {t("settings.keySet")}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex gap-2">
                                    <Input
                                      id={field.key}
                                      type="password"
                                      value={apiKeyValues[field.key] ?? ""}
                                      onChange={(event) =>
                                        setApiKeyValues((current) => ({
                                          ...current,
                                          [field.key]: event.target.value,
                                        }))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          void handleSaveApiKey(field.key);
                                        }
                                      }}
                                      placeholder={
                                        configured
                                          ? t("settings.replaceKey")
                                          : field.placeholder
                                      }
                                      autoComplete="off"
                                      disabled={savingThisKey}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="shrink-0"
                                      onClick={() =>
                                        handleSaveApiKey(field.key)
                                      }
                                      disabled={
                                        savingThisKey ||
                                        !(apiKeyValues[field.key] ?? "").trim()
                                      }
                                    >
                                      {savingThisKey ? (
                                        <IconLoader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        t("common.save")
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <IconUser className="size-4 text-primary" />
                    {t("settings.profile")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">{t("settings.email")}</Label>
                    <Input id="email" value={email} readOnly disabled />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="display-name">
                      {t("settings.displayName")}
                    </Label>
                    <Input
                      id="display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t("settings.displayNamePlaceholder")}
                      disabled={loading}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("settings.playback")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="speed">
                      {t("settings.defaultPlaybackSpeed")}
                    </Label>
                    <Select
                      value={defaultSpeed}
                      onValueChange={setDefaultSpeed}
                      disabled={loading}
                    >
                      <SelectTrigger id="speed" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SPEEDS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}×
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.playbackDescription")}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("settings.transcript")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label
                        htmlFor="transcript-cleanup"
                        className="cursor-pointer"
                      >
                        {t("settings.transcriptCleanup")}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t("settings.transcriptCleanupDescription")}
                      </p>
                    </div>
                    <Switch
                      id="transcript-cleanup"
                      checked={transcriptCleanupEnabled}
                      onCheckedChange={setTranscriptCleanupEnabled}
                      disabled={loading}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("settings.notifications")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="email-notif" className="cursor-pointer">
                        {t("settings.emailNotifications")}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t("settings.emailNotificationsDescription")}
                      </p>
                    </div>
                    <Switch
                      id="email-notif"
                      checked={emailNotifications}
                      onCheckedChange={setEmailNotifications}
                      disabled={loading}
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={loading || saving}
                  className="bg-primary hover:bg-primary/90"
                >
                  {saving ? t("common.saving") : t("common.saveChanges")}
                </Button>
              </div>
            </div>
          </div>
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("organizationSettings.description")}
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-3xl">
            <ChangelogSettingsCard
              markdown={localizedChangelog}
              title={t("settings.whatsNew")}
              closeLabel={t("common.cancel")}
              emptyText={t("settings.changelogEmpty")}
              viewAllLabel={t("settings.viewAllUpdates")}
            />
          </div>
        }
      />
      <AlertDialog
        open={!!disconnectSlackTarget}
        onOpenChange={(open) => {
          if (!open && !disconnectingSlack) setDisconnectSlackTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.disconnectSlackTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.disconnectSlackDescription", {
                team:
                  disconnectSlackTarget?.teamName ||
                  disconnectSlackTarget?.teamId ||
                  t("settings.thisWorkspace"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingSlack}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDisconnectSlack();
              }}
              disabled={disconnectingSlack}
            >
              {disconnectingSlack
                ? t("common.disconnecting")
                : t("common.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
