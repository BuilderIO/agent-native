import { CodeSurface } from "@agent-native/core/blocks";
import {
  useActionQuery,
  useBuilderConnectFlow,
  useBuilderStatus,
  useT,
} from "@agent-native/core/client";
import {
  IconChevronDown,
  IconCheck,
  IconCloud,
  IconCode,
  IconExternalLink,
  IconFilter,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconServer,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useReplayStorageStatus } from "@/hooks/use-replay-storage-status";
import { cn } from "@/lib/utils";

type ReplayRange = "24h" | "7d" | "30d" | "90d" | "all";

const SESSION_REPLAY_DOCS_URL =
  "https://www.agent-native.com/docs/tracking#session-replay";

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
  status: "active" | "completed";
  createdAt: string;
  updatedAt: string;
  lastIngestedAt: string | null;
};

const RANGE_OPTIONS: ReplayRange[] = ["24h", "7d", "30d", "90d", "all"];

export default function SessionsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const range = readRange(searchParams.get("range"));
  const app = searchParams.get("app") ?? "";
  const query = searchParams.get("q") ?? "";
  const from = useMemo(() => rangeToFrom(range), [range]);

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

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    const emptyDefault =
      (key === "range" && value === "30d") || value.trim() === "";
    if (emptyDefault) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 md:px-6">
      <Card>
        <CardContent className="p-3">
          <div className="grid gap-2 lg:grid-cols-[150px_minmax(260px,1fr)_160px_auto_auto] lg:items-center">
            <div className="flex items-center gap-2 px-1 text-sm font-medium">
              <IconFilter className="h-4 w-4 text-muted-foreground" />
              {t("sessions.segmentFilters")}
            </div>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder={t("sessions.searchPlaceholder")}
                className="h-9 ps-9"
              />
            </div>
            <Select
              value={range}
              onValueChange={(value) => updateFilter("range", value)}
            >
              <SelectTrigger className="h-9" aria-label={t("sessions.range")}>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 justify-between gap-2"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
            >
              {t("sessions.filters")}
              <IconChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  filtersOpen && "rotate-180",
                )}
              />
            </Button>
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
          {filtersOpen ? (
            <div className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
                  {t("sessions.userFilters")}
                </div>
                <Input
                  value={app}
                  onChange={(event) => updateFilter("app", event.target.value)}
                  placeholder={t("sessions.appPlaceholder")}
                  className="h-9"
                />
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
                  {t("sessions.eventFilters")}
                </div>
                <div className="flex h-9 items-center rounded-md border bg-background px-3 text-sm text-muted-foreground">
                  {t("sessions.anyActivity")}
                </div>
              </div>
            </div>
          ) : null}
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
                  return (
                    <button
                      key={recording.id}
                      type="button"
                      className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none md:grid-cols-[104px_minmax(170px,0.85fr)_minmax(260px,1.25fr)_minmax(130px,0.55fr)] md:items-center"
                      onClick={() => navigate(href)}
                      aria-label={t("sessions.watchReplay")}
                    >
                      <span className="inline-flex h-10 w-[92px] items-center justify-center gap-2 rounded-md bg-primary/10 font-medium text-primary">
                        <IconPlayerPlay className="h-4 w-4 fill-current" />
                        {formatDuration(recording.durationMs)}
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
                      <span className="min-w-0">
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
                      <span className="min-w-0 text-left md:text-right">
                        <span className="block truncate text-sm text-muted-foreground">
                          {recording.app ||
                            recording.template ||
                            t("sessions.unknownApp")}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5 md:justify-end">
                          {recording.errorCount > 0 ? (
                            <Badge variant="destructive">
                              {t("sessions.errorCount", {
                                count: String(recording.errorCount),
                              })}
                            </Badge>
                          ) : null}
                          {recording.rageClickCount > 0 ? (
                            <Badge variant="secondary">
                              {t("sessions.rageClicks", {
                                count: String(recording.rageClickCount),
                              })}
                            </Badge>
                          ) : null}
                          {recording.errorCount === 0 &&
                          recording.rageClickCount === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {t("sessions.pageCountCompact", {
                                count: formatNumber(recording.pageCount),
                              })}
                            </span>
                          ) : null}
                        </span>
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
      <div className="grid min-h-[380px] gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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

function ReplayStorageHint() {
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

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-md border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
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
      <div className="flex shrink-0 flex-wrap items-center gap-3">
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
        <Link
          to="/settings#replay-storage"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <IconServer className="h-3.5 w-3.5" />
          {t("sessions.configureS3")}
        </Link>
      </div>
    </div>
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
  recording: SessionRecordingSummary,
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

function formatDuration(ms: number | null): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

const SESSION_REPLAY_SNIPPET = `// Agent Native templates already call configureTracking().
import { configureTracking } from "@agent-native/core/client";

configureTracking({
  key: "anpk_...",
  endpoint: "https://analytics.example.com/api/analytics/track",
  sessionReplay: {
    enabled: true,
    requireSignedInUser: true,
    sampleRate: 0.1,
  },
  getDefaultProps: (_event, props) => ({
    ...props,
    app: "my-app",
    template: "my-template",
  }),
});`;
