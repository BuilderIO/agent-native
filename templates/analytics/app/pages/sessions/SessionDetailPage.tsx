import {
  useActionQuery,
  useSendToAgentChat,
  useT,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconClock,
  IconExclamationCircle,
  IconMessageCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

type ReplayChunkEvents = {
  seq: number;
  checksum: string;
  byteLength: number;
  eventCount: number;
  events: unknown[];
  unavailable?: boolean;
};

type SessionReplayEventsResponse = {
  recording: SessionRecordingSummary;
  chunks: ReplayChunkEvents[];
  eventCount: number;
  truncated: boolean;
  unavailableChunks: number;
};

type ReplayPlayerStatus = "idle" | "loading" | "ready" | "error";

export default function SessionDetailPage() {
  const t = useT();
  const { recordingId = "" } = useParams();
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();
  const { data, isLoading, error } =
    useActionQuery<SessionReplayEventsResponse>(
      "get-session-replay-events",
      { recordingId, limit: 10000 },
      { enabled: Boolean(recordingId), staleTime: 30_000 },
    );
  const recording = data?.recording;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      {codeRequiredDialog}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-3">
          <Button variant="ghost" size="sm" asChild className="-ms-2 w-fit">
            <Link to="/sessions">
              <IconArrowLeft className="h-4 w-4" />
              {t("sessions.backToSessions")}
            </Link>
          </Button>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <IconPlayerPlay className="h-5 w-5 text-primary" />
              <h1 className="break-all font-mono text-xl font-semibold tracking-normal md:text-2xl">
                {recording?.sessionId ?? recordingId}
              </h1>
            </div>
            {recording ? (
              <p className="max-w-3xl text-sm text-muted-foreground">
                {recording.app ||
                  recording.template ||
                  t("sessions.unknownApp")}{" "}
                · {formatDateTime(recording.startedAt)} -{" "}
                {formatDateTime(
                  recording.endedAt ??
                    recording.lastIngestedAt ??
                    recording.startedAt,
                )}
              </p>
            ) : null}
          </div>
        </div>
        {recording ? (
          <Button
            type="button"
            variant="outline"
            disabled={isGenerating}
            onClick={() =>
              send({
                type: "content",
                submit: true,
                message: `Summarize session replay recording ${recording.id}. Tell me what the user did, where they struggled, and whether errors or rage clicks stood out.`,
                context: `Use get-session-replay-summary and get-session-replay-events with recordingId=${recording.id}. The visible page is /sessions/${recording.id}.`,
              })
            }
          >
            <IconMessageCircle className="h-4 w-4" />
            {t("sessions.askAgent")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-destructive">
            <IconExclamationCircle className="h-5 w-5" />
            {t("sessions.loadFailed", { message: error.message })}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <DetailSkeleton />
      ) : data && recording ? (
        <>
          <SessionStats recording={recording} />
          <ReplayPlayer response={data} />
          <ReplayChunksTable response={data} />
        </>
      ) : null}
    </div>
  );
}

function SessionStats({ recording }: { recording: SessionRecordingSummary }) {
  const t = useT();
  const stats = [
    [t("sessions.started"), formatDateTime(recording.startedAt)],
    [t("sessions.duration"), formatDuration(recording.durationMs)],
    [t("sessions.events"), formatNumber(recording.eventCount)],
    [t("sessions.pages"), formatNumber(recording.pageCount)],
    [t("sessions.errors"), formatNumber(recording.errorCount)],
    [t("sessions.visitor"), visitorLabel(recording, t)],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map(([label, value]) => (
        <Card key={label}>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 truncate text-sm font-medium">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReplayPlayer({ response }: { response: SessionReplayEventsResponse }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const [status, setStatus] = useState<ReplayPlayerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const events = useMemo(
    () =>
      response.chunks
        .flatMap((chunk) => chunk.events)
        .filter((event) => event && typeof event === "object")
        .sort((a: any, b: any) => {
          const at = Number(a.timestamp ?? 0);
          const bt = Number(b.timestamp ?? 0);
          return at - bt;
        }),
    [response.chunks],
  );

  useEffect(() => {
    if (!rootRef.current) return;
    let cancelled = false;
    let localReplayer: any = null;

    async function loadReplay() {
      if (events.length === 0) {
        throw new Error(t("sessions.noReplayEvents"));
      }
      setStatus("loading");
      setError(null);
      await import("@rrweb/replay/dist/style.css");
      const { Replayer } = await import("@rrweb/replay");
      if (cancelled || !rootRef.current) return;

      rootRef.current.innerHTML = "";
      localReplayer = new Replayer(events as any[], {
        root: rootRef.current,
        skipInactive: true,
        showWarning: false,
        showDebug: false,
        triggerFocus: false,
      });
      replayerRef.current = localReplayer;
      localReplayer.play();
      setStatus("ready");
    }

    void loadReplay().catch((loadError: any) => {
      if (cancelled) return;
      setError(loadError?.message || String(loadError));
      setStatus("error");
    });

    return () => {
      cancelled = true;
      try {
        localReplayer?.destroy?.();
        replayerRef.current?.destroy?.();
      } catch {
        // rrweb cleanup is best-effort across versions.
      }
      replayerRef.current = null;
    };
  }, [events, t]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlayerPlay className="h-4 w-4" />
              {t("sessions.replayPlayer")}
            </CardTitle>
            <CardDescription>
              {t("sessions.chunkAndEventCount", {
                chunks: String(response.chunks.length),
                events: String(response.eventCount),
              })}
              {response.truncated ? ` ${t("sessions.truncated")}` : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={status !== "ready"}
              onClick={() => {
                replayerRef.current?.pause?.();
                replayerRef.current?.play?.(0);
              }}
            >
              <IconPlayerSkipBack className="h-4 w-4" />
              {t("sessions.restart")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("sessions.play")}
              disabled={status !== "ready"}
              onClick={() => replayerRef.current?.play?.()}
            >
              <IconPlayerPlay className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("sessions.pause")}
              disabled={status !== "ready"}
              onClick={() => replayerRef.current?.pause?.()}
            >
              <IconPlayerPause className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div
            ref={rootRef}
            className="min-h-[420px] overflow-hidden rounded-md border bg-muted/20"
          />
          {status === "loading" ? (
            <p className="text-sm text-muted-foreground">
              {t("sessions.replayLoading")}
            </p>
          ) : null}
          {status === "error" && error ? (
            <p className="text-sm text-destructive">
              {t("sessions.loadFailed", { message: error })}
            </p>
          ) : null}
          {response.unavailableChunks > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("sessions.unavailableChunks", {
                count: String(response.unavailableChunks),
              })}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReplayChunksTable({
  response,
}: {
  response: SessionReplayEventsResponse;
}) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("sessions.replayChunks")}
        </CardTitle>
        <CardDescription>
          {t("sessions.replayChunksDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sessions.sequence")}</TableHead>
                <TableHead>{t("sessions.events")}</TableHead>
                <TableHead>{t("sessions.size")}</TableHead>
                <TableHead>{t("sessions.checksum")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {response.chunks.map((chunk) => (
                <TableRow key={chunk.seq}>
                  <TableCell className="font-mono text-xs">
                    {chunk.seq}
                  </TableCell>
                  <TableCell>{formatNumber(chunk.eventCount)}</TableCell>
                  <TableCell>{formatBytes(chunk.byteLength)}</TableCell>
                  <TableCell className="max-w-[360px] truncate font-mono text-xs">
                    {chunk.checksum}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-[520px] w-full" />
    </div>
  );
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
