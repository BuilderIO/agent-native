import { CodeSurface } from "@agent-native/core/blocks";
import { useActionQuery, useT } from "@agent-native/core/client";
import {
  IconCode,
  IconFilter,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ReplayRange = "24h" | "7d" | "30d" | "90d" | "all";

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
  const [searchParams, setSearchParams] = useSearchParams();
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <IconPlayerPlay className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-normal">
              {t("sessions.title")}
            </h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("sessions.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <IconRefresh
            className={cn("h-4 w-4", isFetching && "animate-spin")}
          />
          {t("sessions.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconFilter className="h-4 w-4" />
                {t("sessions.filters")}
              </CardTitle>
              <CardDescription>
                {t("sessions.filtersDescription")}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {data ? (
                <Badge variant="outline">
                  {t("sessions.showing", {
                    count: String(recordings.length),
                  })}
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(160px,0.7fr)_160px]">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder={t("sessions.searchPlaceholder")}
                className="ps-9"
              />
            </div>
            <Input
              value={app}
              onChange={(event) => updateFilter("app", event.target.value)}
              placeholder={t("sessions.appPlaceholder")}
            />
            <Select
              value={range}
              onValueChange={(value) => updateFilter("range", value)}
            >
              <SelectTrigger aria-label={t("sessions.range")}>
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sessions.session")}</TableHead>
                    <TableHead>{t("sessions.app")}</TableHead>
                    <TableHead>{t("sessions.visitor")}</TableHead>
                    <TableHead>{t("sessions.lastSeen")}</TableHead>
                    <TableHead>{t("sessions.duration")}</TableHead>
                    <TableHead className="text-end">
                      {t("sessions.events")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("sessions.chunks")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("sessions.pages")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordings.map((recording) => (
                    <TableRow key={recording.id}>
                      <TableCell className="min-w-[240px]">
                        <Link
                          to={`/sessions/${encodeURIComponent(recording.id)}`}
                          className="font-mono text-xs font-medium text-primary hover:underline"
                        >
                          {shortId(recording.sessionId)}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
                            {t("sessions.replayReady")}
                          </Badge>
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
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[130px]">
                        {recording.app || recording.template || "-"}
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <div className="truncate">
                          {visitorLabel(recording, t)}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        {formatDateTime(
                          recording.endedAt ??
                            recording.lastIngestedAt ??
                            recording.startedAt,
                        )}
                      </TableCell>
                      <TableCell>
                        {formatDuration(recording.durationMs)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatNumber(recording.eventCount)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatNumber(recording.chunkCount)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatNumber(recording.pageCount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptySessionsState() {
  const t = useT();
  return (
    <div className="grid min-h-[380px] gap-6 p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-8">
      <div className="flex flex-col justify-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/40">
          <IconPlayerPlay className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t("sessions.noSessions")}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {t("sessions.noSessionsDescription")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{t("sessions.emptyStepKey")}</Badge>
          <Badge variant="outline">{t("sessions.emptyStepEnv")}</Badge>
          <Badge variant="outline">{t("sessions.emptyStepVisit")}</Badge>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/30">
        <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
          <IconCode className="h-4 w-4" />
          {t("sessions.installSnippetTitle")}
        </div>
        <CodeSurface
          code={SESSION_REPLAY_SNIPPET}
          language="typescript"
          maxLines={null}
          className="mt-0 rounded-none border-0 bg-transparent"
        />
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
  return (
    recording.userId ||
    recording.userKey ||
    recording.anonymousId ||
    t("sessions.anonymous")
  );
}

function shortId(value: string): string {
  return value.length > 22
    ? `${value.slice(0, 10)}...${value.slice(-8)}`
    : value;
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
    sampleRate: 1,
  },
  getDefaultProps: (_event, props) => ({
    ...props,
    app: "my-app",
    template: "my-template",
  }),
});`;
