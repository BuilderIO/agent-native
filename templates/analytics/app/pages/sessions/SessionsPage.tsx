import { CodeSurface } from "@agent-native/core/blocks";
import {
  agentNativePath,
  useActionQuery,
  useBuilderConnectFlow,
  useBuilderStatus,
  useT,
} from "@agent-native/core/client";
import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconCode,
  IconExternalLink,
  IconFilter,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconServer,
  IconSettings,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useReplayStorageStatus } from "@/hooks/use-replay-storage-status";
import { cn } from "@/lib/utils";

type ReplayRange = "24h" | "7d" | "30d" | "90d" | "all";

const SESSION_REPLAY_DOCS_URL =
  "https://www.agent-native.com/docs/tracking#session-replay";

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

type SessionRecordingSummary = {
  id: string;
  clientRecordingId: string;
  sessionId: string;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  chunkCount: number;
  eventCount: number;
  totalBytes: number;
  pageCount: number;
  errorCount: number;
  rageClickCount: number;
  privacyMode: string;
  firstUrl: string | null;
  lastUrl: string | null;
  path: string | null;
  hostname: string | null;
  referrer: string | null;
  app: string | null;
  template: string | null;
  metadata?: Record<string, unknown>;
  status: "active" | "completed";
  createdAt: string;
  updatedAt: string;
  lastIngestedAt: string | null;
};

type SessionRecordingIdentity = Pick<
  SessionRecordingSummary,
  "id" | "userId" | "userKey" | "anonymousId" | "sessionId"
>;

type SessionRecordingDevice = Pick<SessionRecordingSummary, "metadata">;

const RANGE_OPTIONS: ReplayRange[] = ["24h", "7d", "30d", "90d", "all"];
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
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = readRange(searchParams.get("range"));
  const app = searchParams.get("app") ?? "";
  const query = searchParams.get("q") ?? "";
  const from = useMemo(() => rangeToFrom(range), [range]);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const emptyDefault =
            (key === "range" && value === "30d") || value.trim() === "";
          if (emptyDefault) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const commitQuery = useCallback(
    (value: string) => updateFilter("q", value),
    [updateFilter],
  );
  const [queryInput, setQueryInput] = useDebouncedUrlFilter(query, commitQuery);

  const commitApp = useCallback(
    (value: string) => updateFilter("app", value),
    [updateFilter],
  );
  const [appInput, setAppInput] = useDebouncedUrlFilter(app, commitApp);

  const { data, isLoading, isFetching, refetch, error } = useActionQuery<
    SessionRecordingSummary[]
  >(
    "list-session-recordings",
    {
      from: from ?? undefined,
      app: app || undefined,
      query: query || undefined,
      limit: 100,
    },
    { staleTime: 30_000 },
  );

  const recordings = data ?? [];

  return (
    <div className="analytics-sessions-page mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
      <Card>
        <CardContent className="p-3">
          <div className="analytics-sessions-filter-bar flex flex-wrap items-center gap-2">
            <div className="analytics-sessions-filter-label flex items-center gap-2 px-1 text-sm font-medium">
              <IconFilter className="h-4 w-4 text-muted-foreground" />
              {t("sessions.filters")}
            </div>
            <div className="analytics-sessions-filter-search relative min-w-0">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder={t("sessions.searchPlaceholder")}
                className="h-9 ps-9"
              />
            </div>
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      aria-label={t("sessions.filters")}
                    >
                      <IconSettings className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("sessions.filters")}</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-72 p-3">
                <div className="grid gap-3">
                  <div className="text-sm font-medium">
                    {t("sessions.filters")}
                  </div>
                  <div className="grid gap-1.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("sessions.range")}
                    </div>
                    <Select
                      value={range}
                      onValueChange={(value) => updateFilter("range", value)}
                    >
                      <SelectTrigger
                        className="h-9"
                        aria-label={t("sessions.range")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RANGE_OPTIONS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {rangeLabel(value, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5 border-t pt-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("sessions.userFilters")}
                    </div>
                    <Input
                      value={appInput}
                      onChange={(event) => setAppInput(event.target.value)}
                      placeholder={t("sessions.appPlaceholder")}
                      className="h-9"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("sessions.eventFilters")}
                    </div>
                    <div className="flex h-9 items-center rounded-md border bg-muted/20 px-3 text-sm text-muted-foreground">
                      {t("sessions.anyActivity")}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label={t("sessions.refresh")}
            >
              <IconRefresh
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">
              {t("sessions.loadFailed", { message: error.message })}
            </div>
          ) : isLoading ? (
            <SessionSkeleton />
          ) : recordings.length === 0 ? (
            <EmptySessionsState />
          ) : (
            <div>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="text-sm font-medium">
                  {t("sessions.sessionPlaylist")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("sessions.showing", {
                    count: String(recordings.length),
                  })}
                </div>
              </div>
              <div className="divide-y">
                {recordings.map((recording) => {
                  const href = `/sessions/${encodeURIComponent(recording.id)}`;
                  const lastSeen =
                    recording.endedAt ??
                    recording.lastIngestedAt ??
                    recording.startedAt;
                  const deviceLabel = sessionDeviceLabel(recording);
                  return (
                    <button
                      key={recording.id}
                      type="button"
                      className="analytics-session-row grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none"
                      onClick={() => navigate(href)}
                      aria-label={t("sessions.watchReplay")}
                    >
                      <span className="inline-flex h-10 w-[92px] items-center justify-center gap-2 rounded-md bg-primary/10 font-medium text-primary">
                        <IconPlayerPlay className="h-4 w-4 fill-current" />
                        {formatSessionDuration(recording.durationMs)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {visitorLabel(recording, t)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {formatDateTime(lastSeen)} ·{" "}
                          {t("sessions.eventCountCompact", {
                            count: formatNumber(recording.eventCount),
                          })}
                        </span>
                      </span>
                      <span className="analytics-session-path min-w-0">
                        <span className="block truncate text-sm font-medium text-primary">
                          {pathLabel(recording)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {recording.hostname ||
                            recording.app ||
                            recording.template ||
                            shortId(recording.sessionId)}
                        </span>
                      </span>
                      <span className="analytics-session-app-meta min-w-0 text-left">
                        <span className="analytics-session-badges flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                          <span>{formatPageCount(recording.pageCount, t)}</span>
                          {recording.errorCount > 0 ? (
                            <span className="font-medium text-destructive">
                              {t("sessions.errorCount", {
                                count: String(recording.errorCount),
                              })}
                            </span>
                          ) : null}
                          {recording.rageClickCount > 0 ? (
                            <span>
                              {t("sessions.rageClicks", {
                                count: String(recording.rageClickCount),
                              })}
                            </span>
                          ) : null}
                        </span>
                        {deviceLabel ? (
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {deviceLabel}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptySessionsState() {
  const t = useT();
  const storageStatus = useReplayStorageStatus();
  const showStorageHint =
    !storageStatus.isLoading && !storageStatus.data?.configured;
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
    popupUrl:
      builderStatus.status?.cliAuthUrl ?? builderStatus.status?.connectUrl,
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
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() =>
                builderConnect.start({
                  trackingSource: "analytics_sessions_storage_hint",
                  trackingFlow: "replay_storage",
                })
              }
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
              ) : (
                <IconExternalLink className="h-4 w-4" />
              )}
              {builderConnected
                ? t("sessions.storageConnected")
                : t("sessions.connectBuilder")}
            </Button>
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

function SessionSkeleton() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 7 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function readRange(value: string | null): ReplayRange {
  return RANGE_OPTIONS.includes(value as ReplayRange)
    ? (value as ReplayRange)
    : "30d";
}

function rangeToFrom(range: ReplayRange): string | null {
  if (range === "all") return null;
  const hours =
    range === "24h" ? 24 : range === "7d" ? 168 : range === "90d" ? 2160 : 720;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function rangeLabel(value: ReplayRange, t: ReturnType<typeof useT>): string {
  if (value === "24h") return t("sessions.last24h");
  if (value === "7d") return t("sessions.last7d");
  if (value === "30d") return t("sessions.last30d");
  if (value === "90d") return t("sessions.last90d");
  return t("sessions.allTime");
}

function visitorLabel(
  recording: SessionRecordingIdentity,
  t: ReturnType<typeof useT>,
): string {
  const email = emailLike(recording.userId) || emailLike(recording.userKey);
  if (email) return email;
  return (
    recording.userId ||
    recording.userKey ||
    recording.anonymousId ||
    t("sessions.anonymous")
  );
}

function emailLike(value: string | null): string | null {
  if (!value?.includes("@")) return null;
  return value;
}

function shortId(value: string): string {
  return value.length > 22
    ? `${value.slice(0, 10)}...${value.slice(-8)}`
    : value;
}

function pathLabel(recording: SessionRecordingSummary): string {
  if (recording.path) return recording.path;
  if (recording.lastUrl) return safePathFromUrl(recording.lastUrl);
  if (recording.firstUrl) return safePathFromUrl(recording.firstUrl);
  return shortId(recording.sessionId);
}

function safePathFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || url.hostname;
  } catch {
    return value;
  }
}

export function sessionDeviceLabel(
  recording: SessionRecordingDevice,
): string | null {
  const metadata = recordValue(recording.metadata);
  const device = recordValue(metadata.device);
  const browser = recordValue(metadata.browser);
  const client = recordValue(metadata.client);
  const os = osLabelFromValue(
    metadata.os ??
      metadata.operatingSystem ??
      metadata.operating_system ??
      metadata.deviceOs ??
      metadata.device_os ??
      device.os ??
      device.operatingSystem ??
      browser.os ??
      client.os,
  );
  if (os) return os;
  const platform = stringValue(
    metadata.platform ?? device.platform ?? client.platform,
  );
  const platformLabel = inferOsLabel(platform);
  if (platformLabel) return platformLabel;
  const userAgent = stringValue(
    metadata.userAgent ??
      metadata.user_agent ??
      device.userAgent ??
      device.user_agent ??
      client.userAgent ??
      client.user_agent,
  );
  return inferOsLabel(userAgent);
}

function osLabelFromValue(value: unknown): string | null {
  const record = recordValue(value);
  if (record) {
    const name = stringValue(record.name ?? record.family ?? record.os);
    const version = stringValue(record.version ?? record.release);
    if (name && version) return `${normalizeOsName(name)} ${version}`;
    if (name) return normalizeOsName(name);
  }
  const label = stringValue(value);
  if (!label) return null;
  return inferOsLabel(label) ?? label;
}

function inferOsLabel(value: string | null): string | null {
  if (!value) return null;
  if (/cros|chrome os/i.test(value)) return "ChromeOS";
  if (/iphone|ipad|ipod|ios/i.test(value)) return "iOS";
  if (/mac os x|macintosh|macintel|darwin|macos/i.test(value)) return "macOS";
  if (/windows|win32|win64/i.test(value)) return "Windows";
  if (/android/i.test(value)) return "Android";
  if (/linux/i.test(value)) return "Linux";
  return null;
}

function normalizeOsName(value: string): string {
  return inferOsLabel(value) ?? value;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatSessionDuration(ms: number | null): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "0m";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPageCount(value: number, t: ReturnType<typeof useT>): string {
  const count = Math.max(0, Math.round(value || 0));
  if (count === 1) {
    return t("sessions.pageCountCompactSingular", {
      count: formatNumber(count),
    });
  }
  return t("sessions.pageCountCompact", { count: formatNumber(count) });
}

const SESSION_REPLAY_SNIPPET = `// Agent Native templates already call configureTracking().
import { configureTracking } from "@agent-native/core/client";

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
