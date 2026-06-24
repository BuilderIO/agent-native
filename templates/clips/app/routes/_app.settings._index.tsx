import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconBrain,
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
import {
  useSession,
  agentNativePath,
  appApiPath,
  parseChangelog,
  useActionQuery,
  useBuilderConnectFlow,
  useBuilderStatus,
  ChangelogSettingsCard,
} from "@agent-native/core/client";
import changelog from "../../CHANGELOG.md?raw";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";

export function meta() {
  return [{ title: "Settings · Clips" }];
}

const SPEEDS = ["1", "1.2", "1.5", "1.75", "2"];

const S3_STORAGE_FIELDS = [
  {
    key: "S3_ENDPOINT",
    label: "Endpoint URL",
    placeholder: "https://s3.us-east-1.amazonaws.com",
    required: true,
  },
  {
    key: "S3_BUCKET",
    label: "Bucket",
    placeholder: "my-clips-bucket",
    required: true,
  },
  {
    key: "S3_ACCESS_KEY_ID",
    label: "Access key ID",
    placeholder: "AKIA...",
    required: true,
  },
  {
    key: "S3_SECRET_ACCESS_KEY",
    label: "Secret access key",
    placeholder: "••••••••",
    required: true,
    secret: true,
  },
  {
    key: "S3_REGION",
    label: "Region",
    placeholder: "us-east-1",
  },
  {
    key: "S3_PUBLIC_BASE_URL",
    label: "Public base URL",
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

  const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vars, scope: "workspace" }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Save failed (${res.status})`);
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

function CompactChangelogAside() {
  const entries = useMemo(() => parseChangelog(changelog), []);
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  const latestBody = entries[0]?.body ?? "";
  const canExpand = latestBody.length > 260 || entries.length > 1;

  return (
    <aside className="2xl:sticky 2xl:top-6 2xl:self-start">
      <div className="relative">
        <div
          className={cn(
            "overflow-hidden transition-[max-height] duration-200 ease-out",
            expanded ? "max-h-[70vh]" : "max-h-72",
          )}
        >
          <ChangelogSettingsCard
            markdown={changelog}
            limit={1}
            className="rounded-md"
          />
        </div>
        {canExpand && !expanded ? (
          <div className="pointer-events-none absolute inset-x-px bottom-10 h-16 bg-gradient-to-t from-card to-transparent" />
        ) : null}
        {canExpand ? (
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse" : "Expand"}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default function SettingsIndexRoute() {
  const { session } = useSession();
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
      toast.success("Builder.io connected");
    },
  });
  const slackStatus = useActionQuery<SlackInstallationsResponse>(
    "list-slack-installations",
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
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
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
      toast.error("Endpoint, bucket, access key, and secret are required.");
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
      toast.success("Storage settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingStorage(false);
    }
  }

  async function handleSaveApiKey(key: string) {
    const value = (apiKeyValues[key] ?? "").trim();
    if (!value) {
      toast.error("Paste a provider key first.");
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
      toast.success("API key saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key");
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
        toast.success("Slack connected");
      } else {
        toast.message("Slack connection checked");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to connect Slack",
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
      toast.success("Slack disconnected");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to disconnect Slack",
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

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Settings
        </h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-6xl p-6">
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <p className="text-sm text-muted-foreground">
              Preferences and connected services for this Clips workspace.
            </p>

            <Card id="video-storage" className="scroll-mt-16">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <IconCloud className="size-4 text-primary" />
                  Video storage
                </CardTitle>
                <CardDescription>
                  Builder.io is the primary storage path for Clips uploads. S3
                  is available when you need to bring your own bucket.
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
                        ? "Checking Builder.io"
                        : builderConnected
                          ? "Builder.io connected"
                          : "Connect Builder.io"}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {builderConnected
                        ? builderOrgName
                          ? `Using Builder.io for ${builderOrgName}.`
                          : "New clips use the connected Builder.io provider."
                        : "Includes object storage, uploads, and managed transcription for new clips."}
                    </p>
                  </div>
                  {builderConnected ? (
                    <Badge variant="secondary" className="shrink-0">
                      Connected
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
                      Connect Builder.io
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
                          S3-compatible storage
                          <Badge variant="outline" className="text-[10px]">
                            Secondary
                          </Badge>
                          {s3Configured ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Active
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {builderConnected
                            ? "Use this only if this workspace should upload to your own bucket instead of Builder.io."
                            : storageConfigured && activeProviderName
                              ? `Currently using ${activeProviderName}.`
                              : "Use your own bucket if you do not want Builder.io storage."}
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
                            {s3Collapsed ? "Configure S3" : "Hide S3"}
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
                              <Label htmlFor={field.key}>{field.label}</Label>
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
                            disabled={savingStorage || storageStatus.isLoading}
                          >
                            {savingStorage && (
                              <IconLoader2 className="h-4 w-4 animate-spin" />
                            )}
                            Save storage
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
                  Agent-Native Clips for Slack
                </CardTitle>
                <CardDescription>
                  Share a public clip, paste the link in Slack, and it plays
                  inline — no extra steps for viewers. Connect each workspace
                  once.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 rounded-md border border-border bg-accent/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <IconBrandSlack className="h-4 w-4 text-muted-foreground" />
                      {slackStatus.isLoading
                        ? "Checking Slack"
                        : slackConnected
                          ? `${slackInstallations.length} workspace${
                              slackInstallations.length === 1 ? "" : "s"
                            } connected`
                          : slackOauthConfigured
                            ? "Not connected"
                            : "OAuth credentials needed"}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Public Clips links can render as playable Slack previews.
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
                    Connect Slack
                  </Button>
                </div>

                {!slackOauthConfigured ? (
                  <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                    Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET for this
                    deployment before connecting workspaces.
                  </div>
                ) : null}

                {!slackSigningConfigured ? (
                  <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                    Set SLACK_SIGNING_SECRET so Slack event callbacks can be
                    verified.
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
                            <span>Connected by {installation.ownerEmail}</span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          aria-label={`Disconnect ${
                            installation.teamName || installation.teamId
                          }`}
                          onClick={() => setDisconnectSlackTarget(installation)}
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
                  AI setup
                </CardTitle>
                <CardDescription>
                  Builder.io is the default path for managed AI credits.
                  Provider keys are optional and can be added here.
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
                        ? "Checking Builder.io"
                        : builderConnected
                          ? "Builder.io connected"
                          : "Builder.io is the easiest setup"}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {builderConnected
                        ? "Included AI credits and managed transcription are available for Clips."
                        : "Connect Builder first for included AI credits, object storage, uploads, and managed transcription."}
                    </p>
                  </div>
                  {builderConnected ? (
                    <Badge variant="secondary" className="shrink-0">
                      Connected
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
                      Connect Builder.io
                    </Button>
                  )}
                </div>

                <Collapsible
                  open={apiKeysExpanded}
                  onOpenChange={setApiKeysExpanded}
                >
                  <div className="rounded-md border border-border">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <IconKey className="h-4 w-4 text-muted-foreground" />
                            Bring your own provider key
                            {configuredApiKeyCount > 0 ? (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {configuredApiKeyCount} set
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Add Anthropic, OpenAI, Gemini, Groq, or OpenRouter
                            keys for provider-billed usage.
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
                            Checking provider keys…
                          </div>
                        ) : null}
                        <div className="grid gap-3 sm:grid-cols-2">
                          {AI_PROVIDER_FIELDS.map((field) => {
                            const configured = Boolean(apiKeyStatus[field.key]);
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
                                      Set
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
                                        ? "Replace key…"
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
                                    onClick={() => handleSaveApiKey(field.key)}
                                    disabled={
                                      savingThisKey ||
                                      !(apiKeyValues[field.key] ?? "").trim()
                                    }
                                  >
                                    {savingThisKey ? (
                                      <IconLoader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      "Save"
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
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={email} readOnly disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    disabled={loading}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Playback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="speed">Default playback speed</Label>
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
                    Applied automatically when you open a recording.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Transcript</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label
                      htmlFor="transcript-cleanup"
                      className="cursor-pointer"
                    >
                      Background cleanup
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Show the native transcript immediately, then clean it up
                      in the background when available.
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
                <CardTitle className="text-base">Notifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-notif" className="cursor-pointer">
                      Email notifications
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Get an email when someone comments, reacts, or shares a
                      recording with you.
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
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
          <CompactChangelogAside />
        </div>
      </div>
      <AlertDialog
        open={!!disconnectSlackTarget}
        onOpenChange={(open) => {
          if (!open && !disconnectingSlack) setDisconnectSlackTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
            <AlertDialogDescription>
              Clips will delete the stored bot token for{" "}
              {disconnectSlackTarget?.teamName ||
                disconnectSlackTarget?.teamId ||
                "this workspace"}{" "}
              and stop sending playable Slack previews.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingSlack}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDisconnectSlack();
              }}
              disabled={disconnectingSlack}
            >
              {disconnectingSlack ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
