import { useEffect, useState } from "react";
import {
  IconBrain,
  IconCloud,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconServer,
  IconUser,
} from "@tabler/icons-react";
import {
  useSession,
  agentNativePath,
  openBuilderConnectPopup,
  saveAgentEngineApiKey,
  type AgentEngineProvider,
} from "@agent-native/core/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/library/page-header";
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

type AiKeyField =
  | {
      key: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";
      label: string;
      description: string;
      placeholder: string;
      docsUrl: string;
      kind: "agent-engine";
      provider: AgentEngineProvider;
    }
  | {
      key: "GEMINI_API_KEY" | "GROQ_API_KEY";
      label: string;
      description: string;
      placeholder: string;
      docsUrl: string;
      kind: "registered-secret";
    };

const AI_KEY_FIELDS: AiKeyField[] = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    description: "Runs the agent chat for summaries, chapters, and AI tools.",
    placeholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    kind: "agent-engine",
    provider: "anthropic",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    description: "Alternate agent-chat provider for AI tools.",
    placeholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    kind: "agent-engine",
    provider: "openai",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API key",
    description:
      "Cleans transcripts, titles clips, and generates meeting notes.",
    placeholder: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
    kind: "registered-secret",
  },
  {
    key: "GROQ_API_KEY",
    label: "Groq API key",
    description:
      "Backup speech-to-text when native or Builder transcription is unavailable.",
    placeholder: "gsk_...",
    docsUrl: "https://console.groq.com/keys",
    kind: "registered-secret",
  },
];

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

interface ClipsUserSettings {
  defaultPlaybackSpeed?: string;
  emailNotifications?: boolean;
  displayName?: string;
  transcriptCleanupEnabled?: boolean;
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
  const email = session?.email ?? "";
  const storageStatus = useVideoStorageStatus();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingStorage, setSavingStorage] = useState(false);
  const [defaultSpeed, setDefaultSpeed] = useState("1.2");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [transcriptCleanupEnabled, setTranscriptCleanupEnabled] =
    useState(true);
  const [s3Values, setS3Values] = useState<Record<string, string>>({});
  const [aiKeyValues, setAiKeyValues] = useState<Record<string, string>>({});
  const [savingAiKey, setSavingAiKey] = useState<string | null>(null);

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

  async function handleSaveAiKey(field: AiKeyField) {
    const value = (aiKeyValues[field.key] ?? "").trim();
    if (!value) {
      toast.error("Paste a key first.");
      return;
    }

    setSavingAiKey(field.key);
    try {
      if (field.kind === "agent-engine") {
        await saveAgentEngineApiKey({
          provider: field.provider,
          apiKey: value,
        });
      } else {
        await saveRegisteredSecret(field.key, value);
      }
      setAiKeyValues((current) => ({ ...current, [field.key]: "" }));
      toast.success(`${field.label} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingAiKey(null);
    }
  }

  const storageConfigured = !!storageStatus.data?.configured;
  const activeProviderName = storageStatus.data?.activeProvider?.name ?? null;

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Settings
        </h1>
      </PageHeader>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          Your personal preferences — scoped to this account.
        </p>

        <Card id="video-storage" className="scroll-mt-16">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IconCloud className="size-4 text-primary" />
              Video storage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-accent/30 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconServer className="h-4 w-4 text-muted-foreground" />
                  {storageStatus.isLoading
                    ? "Checking storage"
                    : storageConfigured
                      ? (activeProviderName ?? "Storage connected")
                      : "Not connected"}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {storageConfigured
                    ? "New clips will upload to the connected provider."
                    : "Save S3-compatible credentials or connect Builder.io from the recorder."}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {storageConfigured ? "Connected" : "Pending"}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {S3_STORAGE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    type={
                      "secret" in field && field.secret ? "password" : "text"
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
          </CardContent>
        </Card>

        <Card id="ai-providers" className="scroll-mt-16">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IconBrain className="size-4 text-primary" />
              AI providers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-3 rounded-md border border-border bg-accent/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconKey className="h-4 w-4 text-muted-foreground" />
                  Builder.io or bring your own keys
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Builder.io uses your Builder credits. BYOK routes usage to
                  your provider account.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  openBuilderConnectPopup({
                    source: "clips_settings_ai_providers",
                  });
                  toast.message("Finish connecting Builder.io in the popup.");
                }}
              >
                <IconExternalLink className="h-4 w-4" />
                Connect Builder.io
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {AI_KEY_FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="space-y-2 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {field.description}
                    </p>
                  </div>
                  <Input
                    id={field.key}
                    type="password"
                    value={aiKeyValues[field.key] ?? ""}
                    onChange={(event) =>
                      setAiKeyValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleSaveAiKey(field);
                      }
                    }}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    disabled={savingAiKey === field.key}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={field.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Get key
                      <IconExternalLink className="h-3 w-3" />
                    </a>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleSaveAiKey(field)}
                      disabled={
                        savingAiKey === field.key ||
                        !(aiKeyValues[field.key] ?? "").trim()
                      }
                    >
                      {savingAiKey === field.key && (
                        <IconLoader2 className="h-4 w-4 animate-spin" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              ))}
            </div>
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
                <Label htmlFor="transcript-cleanup" className="cursor-pointer">
                  Background cleanup
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Show the native transcript immediately, then clean it up in
                  the background when available.
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
    </>
  );
}
