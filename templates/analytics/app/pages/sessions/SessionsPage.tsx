import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { docsUrl } from "@agent-native/core/shared";
import { CodeSurface } from "@agent-native/toolkit/app/blocks";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
  useBuilderStatus,
} from "@agent-native/toolkit/app/settings";
import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconCode,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconServer,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReplayStorageStatus } from "@/hooks/use-replay-storage-status";
import { cn } from "@/lib/utils";

import { SessionsTriagePage } from "./SessionsTriagePage";

const SESSION_REPLAY_DOCS_URL = docsUrl("tracking", {
  hash: "session-replay",
});

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
    placeholder: "my-replays-bucket",
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

async function saveS3StorageSettings(
  values: Record<string, string>,
): Promise<void> {
  const vars = S3_STORAGE_FIELDS.map((field) => ({
    key: field.key,
    value: (values[field.key] ?? "").trim(),
  })).filter((entry) => entry.value.length > 0);

  for (const { key, value } of vars) {
    const res = await fetch(agentNativePath("/_agent-native/secrets/adhoc"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: key,
        value,
        scope: "workspace",
        description: "Analytics S3-compatible replay storage", // i18n-ignore -- secret metadata description, not visible UI
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

const MIN_DURATION_FOR_ONE_MINUTE_LABEL_MS = 59_500;
const SESSION_QUERY_DEBOUNCE_MS = 250;

/**
 * Local input state for a URL-backed filter, debounced into the URL.
 *
 * `urlValue` only resyncs local state when it changes for a reason other
 * than this hook's own debounced write (back/forward navigation, an agent
 * driven URL change, etc). React Router commits `setSearchParams` inside a
 * transition, so without this guard the echo of our own write can land
 * after a newer keystroke and clobber it.
 */
export function shouldShowZeroMinuteRecoveryAction(
  includeZeroMinuteSessions: boolean,
  filteredCount: number,
  unfilteredCount: number,
): boolean {
  return (
    !includeZeroMinuteSessions && filteredCount === 0 && unfilteredCount > 0
  );
}
export function useDebouncedUrlFilter(
  urlValue: string,
  onCommit: (value: string) => void,
): [string, (value: string) => void] {
  const [input, setInput] = useState(urlValue);
  const lastPushedRef = useRef(urlValue);

  useEffect(() => {
    if (urlValue === lastPushedRef.current) return;
    lastPushedRef.current = urlValue;
    setInput(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (input === urlValue) return;
    const timeout = window.setTimeout(() => {
      lastPushedRef.current = input;
      onCommit(input);
    }, SESSION_QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [input, urlValue, onCommit]);

  return [input, setInput];
}

export default function SessionsPage() {
  return <SessionsTriagePage />;
}

export function EmptySessionsState() {
  const t = useT();
  const storageStatus = useReplayStorageStatus();
  const showStorageHint =
    !storageStatus.isLoading && storageStatus.data?.configured === false;
  return (
    <div className="p-6 lg:p-8">
      {showStorageHint ? <ReplayStorageHint /> : null}
      <div className="analytics-sessions-empty-grid grid min-h-[380px] gap-6">
        <div className="flex flex-col justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/40">
            <IconPlayerPlay className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">
              {t("sessions.noSessions")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {t("sessions.noSessionsDescription")}
            </p>
          </div>
        </div>
        <div className="analytics-session-snippet overflow-hidden rounded-md border bg-muted/30">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <IconCode className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">
                {t("sessions.installSnippetTitle")}
              </span>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
            >
              <a
                href={SESSION_REPLAY_DOCS_URL}
                target="_blank"
                rel="noreferrer"
              >
                {t("common.docs")}
                <IconExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
          <CodeSurface
            code={SESSION_REPLAY_SNIPPET}
            language="typescript"
            maxLines={null}
            showLanguageLabel={false}
            className="mt-0"
          />
        </div>
      </div>
    </div>
  );
}

export function ReplayStorageHint({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const t = useT();
  const storageStatus = useReplayStorageStatus();
  const builderStatus = useBuilderStatus();
  const builderConnect = useBuilderConnectFlow({
    popupUrl: builderStatus.status?.connectUrl,
    provisionAccount: true,
    trackingSource: "analytics_sessions_storage_hint",
    trackingFlow: "replay_storage",
    onConnected: async () => {
      await Promise.all([storageStatus.refetch(), builderStatus.refetch()]);
    },
  });

  const builderConnected = Boolean(
    builderConnect.configured ||
    builderStatus.status?.configured ||
    storageStatus.data?.builderConfigured,
  );
  const builderStatusLoading =
    storageStatus.isLoading ||
    builderStatus.loading ||
    !builderConnect.hasFetchedStatus;
  const [s3Expanded, setS3Expanded] = useState(false);
  const [s3Values, setS3Values] = useState<Record<string, string>>({});
  const [savingStorage, setSavingStorage] = useState(false);

  async function handleSaveS3Storage() {
    const missing = S3_STORAGE_FIELDS.filter(
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
        err instanceof Error ? err.message : t("settings.storageSaveFailed"),
      );
    } finally {
      setSavingStorage(false);
    }
  }

  return (
    <Collapsible open={s3Expanded} onOpenChange={setS3Expanded}>
      <div
        className={cn(
          !embedded &&
            "mb-6 rounded-md border border-primary/30 bg-primary/5 p-4",
        )}
      >
        <div className="flex flex-wrap items-center gap-4">
          {!embedded ? (
            <div className="flex min-w-[min(100%,24rem)] flex-1 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-primary">
                <IconCloud className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {t("sessions.storageSetupTitle")}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("sessions.storageSetupDescription")}
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex max-w-full flex-wrap items-center gap-3">
            <BuilderConnectPopover flow={builderConnect}>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={
                  builderConnect.connecting ||
                  builderStatusLoading ||
                  builderConnected
                }
              >
                {builderConnect.connecting ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : builderConnected ? (
                  <IconCheck className="h-4 w-4" />
                ) : null}
                {builderConnected
                  ? t("sessions.storageConnected")
                  : t("sessions.connectBuilder")}
              </Button>
            </BuilderConnectPopover>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <IconServer className="h-3.5 w-3.5" />
                {t("sessions.configureS3")}
                <Badge variant="outline" className="text-[10px]">
                  {t("settings.secondary")}
                </Badge>
                <IconChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    s3Expanded && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          <div
            className={cn(
              "mt-4 border-t pt-4",
              embedded ? "border-border" : "border-primary/20",
            )}
          >
            <p className="mb-4 text-xs text-muted-foreground">
              {t("settings.s3OwnBucketDescription")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {S3_STORAGE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`replay-${field.key}`}>
                    {t(field.labelKey)}
                  </Label>
                  <Input
                    id={`replay-${field.key}`}
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
            <div className="mt-4 flex justify-end">
              <Button
                onClick={handleSaveS3Storage}
                disabled={savingStorage || storageStatus.isLoading}
              >
                {savingStorage ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t("settings.saveStorage")}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function formatSessionDuration(ms: number | null): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "0m";
  if (ms < MIN_DURATION_FOR_ONE_MINUTE_LABEL_MS) return "0m";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

const SESSION_REPLAY_SNIPPET = `// Agent-Native templates already call configureTracking().
import { configureTracking } from "@agent-native/core/client/observability";

configureTracking({
  key: "anpk_...",
  endpoint: "https://analytics.example.com/api/analytics/track",
  sessionReplay: {
    enabled: true,
    requireSignedInUser: true,
    sampleRate: 1,
  },
  getDefaultProps: (_event, props) => ({
    ...props,
    app: "my-app",
    template: "my-template",
  }),
});`;
