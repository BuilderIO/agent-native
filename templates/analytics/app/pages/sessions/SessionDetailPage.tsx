import {
  PromptComposer,
  useActionQuery,
  useSendToAgentChat,
  useT,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconExclamationCircle,
  IconKeyboard,
  IconMessageCircle,
  IconMouse,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerTrackNext,
  IconRoute,
  IconTimelineEvent,
} from "@tabler/icons-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

type AnyReplayEvent = Record<string, any>;
type AnyRecord = Record<string, any>;

type ReplayPlayerStatus = "idle" | "loading" | "ready" | "error";

type ReplayMarker = {
  id: string;
  offsetMs: number;
  timestamp: number;
  kind: "navigation" | "input" | "click" | "custom";
  label: string;
  detail?: string;
};

type SkipRange = {
  startMs: number;
  endMs: number;
};

const DEFAULT_PLAYER_WIDTH = 1024;
const DEFAULT_PLAYER_HEIGHT = 640;
const DEFAULT_SPEED = 2;
const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];
const SKIP_STEP_MS = 5000;
const MIN_IDLE_SKIP_MS = 8000;
const IDLE_EDGE_PAD_MS = 1200;

const RRWEB_EVENT_TYPE = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const;

const INCREMENTAL_SOURCE = {
  Mutation: 0,
  MouseInteraction: 2,
  Scroll: 3,
  Input: 5,
  TouchMove: 6,
} as const;

const MOUSE_INTERACTION = {
  Click: 2,
  DblClick: 4,
  Focus: 5,
} as const;

const INTERACTION_SOURCES = new Set<number>([
  INCREMENTAL_SOURCE.MouseInteraction,
  INCREMENTAL_SOURCE.Scroll,
  INCREMENTAL_SOURCE.Input,
  INCREMENTAL_SOURCE.TouchMove,
]);

export default function SessionDetailPage() {
  const t = useT();
  const { recordingId = "" } = useParams();
  const { codeRequiredDialog } = useSendToAgentChat();
  const { data, isLoading, error } =
    useActionQuery<SessionReplayEventsResponse>(
      "get-session-replay-events",
      { recordingId, limit: 10000 },
      { enabled: Boolean(recordingId), staleTime: 30_000 },
    );
  const recording = data?.recording;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden">
      {codeRequiredDialog}
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link to="/sessions">
              <IconArrowLeft className="h-4 w-4" />
              {t("sessions.backToSessions")}
            </Link>
          </Button>
          {recording ? (
            <div className="min-w-0 border-l pl-3 text-xs text-muted-foreground">
              <span className="truncate">
                {recording.app ||
                  recording.template ||
                  t("sessions.unknownApp")}{" "}
                · {formatDuration(recording.durationMs)} ·{" "}
                {t("sessions.eventCountCompact", {
                  count: formatNumber(recording.eventCount),
                })}{" "}
                · {visitorLabel(recording, t)}
              </span>
            </div>
          ) : null}
        </div>
        {recording ? <AskSessionPopover recording={recording} /> : null}
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
        <div className="min-h-0 flex-1">
          <ReplayWorkbench response={data} />
        </div>
      ) : null}
    </div>
  );
}

function AskSessionPopover({
  recording,
}: {
  recording: SessionRecordingSummary;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { send, isGenerating } = useSendToAgentChat();

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    send({
      message: trimmed,
      context:
        `The user is looking at session replay recording ${recording.id} on /sessions/${recording.id}. ` +
        `Use get-session-replay-summary first, and only use bounded get-session-replay-events if the user asks about timeline details. ` +
        `Keep raw rrweb JSON out of the answer; summarize the session, friction, errors, rage clicks, navigation, and next investigative steps.`,
      submit: true,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={isGenerating}>
          <IconMessageCircle className="h-4 w-4" />
          {t("sessions.askAgent")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] p-3 sm:w-[460px]"
        align="end"
      >
        <div className="px-1 pb-2">
          <p className="text-sm font-semibold text-foreground">
            {t("sessions.askSessionTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("sessions.askSessionDescription")}
          </p>
        </div>
        <PromptComposer
          autoFocus
          disabled={isGenerating}
          placeholder={t("sessions.askSessionPlaceholder")}
          draftScope={`analytics:session-replay:${recording.id}`}
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}

function ReplayWorkbench({
  response,
}: {
  response: SessionReplayEventsResponse;
}) {
  const events = useReplayEvents(response);
  const markers = useMemo(() => buildReplayMarkers(events), [events]);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const seekRef = useRef<(ms: number, autoplay?: boolean) => void>(() => {});
  const registerSeek = useCallback(
    (seek: (ms: number, autoplay?: boolean) => void) => {
      seekRef.current = seek;
    },
    [],
  );

  useEffect(() => {
    let active: ReplayMarker | null = null;
    for (const marker of markers) {
      if (marker.offsetMs <= currentTime + 250) active = marker;
      else break;
    }
    setActiveMarkerId(active?.id ?? null);
  }, [currentTime, markers]);

  return (
    <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
      <ReplayPlayer
        events={events}
        markers={markers}
        response={response}
        onTimeUpdate={setCurrentTime}
        registerSeek={registerSeek}
      />
      <ReplayTimeline
        markers={markers}
        activeMarkerId={activeMarkerId}
        onSeek={(ms) => seekRef.current(ms, true)}
      />
    </div>
  );
}

function ReplayPlayer({
  events,
  markers,
  response,
  onTimeUpdate,
  registerSeek,
}: {
  events: AnyReplayEvent[];
  markers: ReplayMarker[];
  response: SessionReplayEventsResponse;
  onTimeUpdate: (ms: number) => void;
  registerSeek: (seek: (ms: number, autoplay?: boolean) => void) => void;
}) {
  const t = useT();
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const stageRootRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<ReplayPlayerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [skipInactive, setSkipInactive] = useState(true);
  const [streamedDims, setStreamedDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [fitScale, setFitScale] = useState(1);

  const playerWidth = streamedDims?.width ?? DEFAULT_PLAYER_WIDTH;
  const playerHeight = streamedDims?.height ?? DEFAULT_PLAYER_HEIGHT;
  const skipRanges = useMemo(() => buildIdleSkipRanges(events), [events]);
  const skipRangesRef = useLiveRef(skipRanges);
  const skipInactiveRef = useLiveRef(skipInactive);
  const currentTimeRef = useLiveRef(currentTime);
  const playingRef = useLiveRef(playing);

  const currentUrl = useMemo(
    () => currentUrlAt(events, currentTime),
    [events, currentTime],
  );

  useEffect(() => {
    const el = stageAreaRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.min(
        el.clientWidth / playerWidth,
        el.clientHeight / playerHeight,
      );
      setFitScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [playerHeight, playerWidth]);

  const updateTime = useCallback(
    (next: number) => {
      setCurrentTime(next);
      onTimeUpdate(next);
    },
    [onTimeUpdate],
  );

  const seek = useCallback(
    (ms: number, autoplay = playingRef.current) => {
      const replayer = replayerRef.current;
      if (!replayer || status !== "ready") return;
      const clamped = clamp(ms, 0, Math.max(totalTime, 0));
      try {
        if (autoplay) {
          replayer.play(clamped);
          setPlaying(true);
        } else {
          replayer.pause(clamped);
          setPlaying(false);
        }
      } catch (seekError) {
        console.warn("[session-replay] seek failed", seekError);
        return;
      }
      updateTime(clamped);
    },
    [playingRef, status, totalTime, updateTime],
  );

  useEffect(() => {
    registerSeek(seek);
  }, [registerSeek, seek]);

  useEffect(() => {
    if (!stageRootRef.current) return;
    let cancelled = false;
    let localReplayer: any = null;

    async function loadReplay() {
      if (events.length < 2) {
        throw new Error(t("sessions.noReplayEvents"));
      }
      setStatus("loading");
      setError(null);
      await import("@rrweb/replay/dist/style.css");
      const { Replayer } = await import("@rrweb/replay");
      if (cancelled || !stageRootRef.current) return;

      stageRootRef.current.innerHTML = "";
      setStreamedDims(null);
      localReplayer = new Replayer(events as any[], {
        root: stageRootRef.current,
        speed: DEFAULT_SPEED,
        skipInactive: false,
        showWarning: false,
        showDebug: false,
        triggerFocus: false,
        mouseTail: false,
        insertStyleRules: [
          "[data-radix-popper-content-wrapper], .Toastify, [class*='toast'], [class*='Toast'] { display: none !important; }",
        ],
      });
      replayerRef.current = localReplayer;
      const meta = localReplayer.getMetaData?.();
      const total = Number(meta?.totalTime ?? replayDuration(events));
      setTotalTime(Number.isFinite(total) ? total : 0);
      localReplayer.on?.("finish", () => {
        setPlaying(false);
        const finalTime = Number(localReplayer.getCurrentTime?.() ?? total);
        updateTime(Number.isFinite(finalTime) ? finalTime : total);
      });
      localReplayer.on?.("resize", (payload: unknown) => {
        const dims = payload as { width?: unknown; height?: unknown };
        if (typeof dims.width === "number" && typeof dims.height === "number") {
          setStreamedDims({ width: dims.width, height: dims.height });
        }
      });
      updateTime(0);
      setStatus("ready");
      try {
        localReplayer.play?.(0);
        setPlaying(true);
      } catch (autoplayError) {
        console.warn("[session-replay] autoplay failed", autoplayError);
        try {
          localReplayer.pause?.(0);
        } catch {
          // Some rrweb versions only render after play; the first click still works.
        }
        setPlaying(false);
      }
    }

    void loadReplay().catch((loadError: any) => {
      if (cancelled) return;
      setError(loadError?.message || String(loadError));
      setStatus("error");
      setPlaying(false);
    });

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try {
        localReplayer?.pause?.();
        localReplayer?.destroy?.();
        replayerRef.current?.destroy?.();
      } catch {
        // rrweb cleanup is best-effort across versions.
      }
      replayerRef.current = null;
      if (stageRootRef.current) stageRootRef.current.innerHTML = "";
    };
  }, [events, t, updateTime]);

  useEffect(() => {
    if (!playing || status !== "ready") {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = () => {
      const replayer = replayerRef.current;
      if (replayer) {
        let nextTime = Number(
          replayer.getCurrentTime?.() ?? currentTimeRef.current,
        );
        if (skipInactiveRef.current) {
          const range = skipRangesRef.current.find(
            (candidate) =>
              nextTime >= candidate.startMs && nextTime < candidate.endMs - 50,
          );
          if (range) {
            try {
              replayer.play(range.endMs);
              nextTime = range.endMs;
            } catch (skipError) {
              console.warn(
                "[session-replay] skip inactivity failed",
                skipError,
              );
            }
          }
        }
        if (Number.isFinite(nextTime)) updateTime(nextTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [
    currentTimeRef,
    playing,
    skipInactiveRef,
    skipRangesRef,
    status,
    updateTime,
  ]);

  function togglePlay() {
    if (status !== "ready") return;
    const replayer = replayerRef.current;
    if (!replayer) return;
    if (playing) {
      try {
        replayer.pause();
      } catch {
        // Ignore transient rrweb pause errors.
      }
      setPlaying(false);
      return;
    }
    const restart = totalTime > 0 && currentTime >= totalTime - 50;
    const startAt = restart ? 0 : currentTime;
    try {
      replayer.play(startAt);
      updateTime(startAt);
      setPlaying(true);
    } catch (playError) {
      setError(
        playError instanceof Error ? playError.message : String(playError),
      );
      setStatus("error");
    }
  }

  function updateSpeed(next: number) {
    setSpeed(next);
    try {
      replayerRef.current?.setConfig?.({ speed: next });
    } catch {
      // Older rrweb builds may not expose setConfig; new sessions still use it.
    }
  }

  const disabled = status !== "ready";

  return (
    <TooltipProvider>
      <Card className="flex min-h-0 overflow-hidden">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="flex min-h-0 flex-1 flex-col bg-muted/20 p-2">
            {currentUrl ? (
              <div
                className="flex h-8 shrink-0 items-center rounded-t-md border border-b-0 bg-background px-3 font-mono text-xs text-muted-foreground"
                title={currentUrl}
              >
                <span className="truncate">{currentUrl}</span>
              </div>
            ) : null}
            <div
              ref={stageAreaRef}
              className={cn(
                "relative min-h-[320px] flex-1 overflow-hidden border bg-white dark:bg-zinc-950",
                currentUrl ? "rounded-b-md" : "rounded-md",
              )}
            >
              <div
                ref={stageRootRef}
                className="an-replay-stage-root absolute left-1/2 top-1/2"
                style={{
                  width: playerWidth,
                  height: playerHeight,
                  transform: `translate(-50%, -50%) scale(${fitScale})`,
                  transformOrigin: "center center",
                }}
              />
              <button
                type="button"
                className="absolute inset-0 z-20 cursor-pointer rounded-[inherit] border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default"
                disabled={disabled}
                aria-label={playing ? t("sessions.pause") : t("sessions.play")}
                onClick={togglePlay}
              />
              {status === "loading" ? (
                <div className="absolute inset-0 z-30 grid place-items-center bg-background/70 text-sm text-muted-foreground">
                  {t("sessions.replayLoading")}
                </div>
              ) : null}
              {status === "error" && error ? (
                <div className="absolute inset-0 z-30 grid place-items-center bg-background/85 p-6 text-center text-sm text-destructive">
                  {t("sessions.loadFailed", { message: error })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">
            <ReplayIconButton
              label={t("sessions.skipBack")}
              disabled={disabled}
              onClick={() => seek(currentTime - SKIP_STEP_MS)}
            >
              <IconPlayerSkipBack className="h-4 w-4" />
            </ReplayIconButton>
            <Button
              type="button"
              size="icon"
              disabled={disabled}
              onClick={togglePlay}
              aria-label={playing ? t("sessions.pause") : t("sessions.play")}
              className="h-8 w-8"
            >
              {playing ? (
                <IconPlayerPause className="h-4 w-4" />
              ) : (
                <IconPlayerPlay className="h-4 w-4" />
              )}
            </Button>
            <ReplayIconButton
              label={t("sessions.skipForward")}
              disabled={disabled}
              onClick={() => seek(currentTime + SKIP_STEP_MS)}
            >
              <IconPlayerSkipForward className="h-4 w-4" />
            </ReplayIconButton>

            <span className="w-12 text-center font-mono text-xs text-muted-foreground">
              {formatClock(currentTime)}
            </span>
            <ReplayScrubber
              currentTime={currentTime}
              totalTime={totalTime}
              markers={markers}
              skipRanges={skipRanges}
              skipInactive={skipInactive}
              disabled={disabled}
              onSeek={(ms) => seek(ms)}
            />
            <span className="w-12 text-center font-mono text-xs text-muted-foreground">
              {formatClock(totalTime)}
            </span>

            <div className="flex items-center rounded-md bg-muted p-1">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                    speed === option &&
                      "bg-background text-foreground shadow-sm",
                  )}
                  onClick={() => updateSpeed(option)}
                >
                  {option}x
                </button>
              ))}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors hover:bg-muted",
                    skipInactive &&
                      "border-primary/40 bg-primary/10 text-primary",
                  )}
                  onClick={() => setSkipInactive((value) => !value)}
                  aria-pressed={skipInactive}
                >
                  <IconPlayerTrackNext className="h-4 w-4" />
                  {t("sessions.skipInactive")}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {skipInactive
                  ? t("sessions.skipInactiveOn")
                  : t("sessions.skipInactiveOff")}
              </TooltipContent>
            </Tooltip>
            <span className="ms-auto hidden text-xs text-muted-foreground lg:inline">
              {t("sessions.replayEventCount", {
                events: String(response.eventCount),
              })}
              {response.truncated ? ` ${t("sessions.truncated")}` : ""}
            </span>
          </div>

          {response.unavailableChunks > 0 ? (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {t("sessions.unavailableChunks", {
                count: String(response.unavailableChunks),
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

function ReplayScrubber({
  currentTime,
  totalTime,
  markers,
  skipRanges,
  skipInactive,
  disabled,
  onSeek,
}: {
  currentTime: number;
  totalTime: number;
  markers: ReplayMarker[];
  skipRanges: SkipRange[];
  skipInactive: boolean;
  disabled: boolean;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  return (
    <div className="relative min-h-8 min-w-[180px] flex-1">
      <input
        type="range"
        className="an-replay-scrub absolute left-0 top-1/2 z-20 w-full -translate-y-1/2"
        min={0}
        max={Math.max(0, totalTime)}
        step={50}
        value={Math.min(currentTime, totalTime)}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={t("sessions.replayTimeline")}
      />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-2 -translate-y-1/2 overflow-hidden rounded-full">
        {skipRanges.map((range) => {
          const left = totalTime > 0 ? (range.startMs / totalTime) * 100 : 0;
          const width =
            totalTime > 0
              ? ((range.endMs - range.startMs) / totalTime) * 100
              : 0;
          return (
            <span
              key={`${range.startMs}-${range.endMs}`}
              className={cn(
                "absolute top-0 h-full rounded-full bg-muted-foreground transition-opacity",
                skipInactive ? "opacity-30" : "opacity-10",
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 h-5 -translate-y-1/2">
        {markers.slice(0, 200).map((marker) => {
          const left = totalTime > 0 ? (marker.offsetMs / totalTime) * 100 : 0;
          return (
            <span
              key={marker.id}
              className={cn(
                "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                marker.kind === "navigation"
                  ? "bg-amber-500"
                  : marker.kind === "input"
                    ? "bg-emerald-500"
                    : marker.kind === "click"
                      ? "bg-sky-500"
                      : "bg-violet-500",
              )}
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReplayIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ReplayTimeline({
  markers,
  activeMarkerId,
  onSeek,
}: {
  markers: ReplayMarker[];
  activeMarkerId: string | null;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const visibleMarkers = markers.slice(0, 120);
  return (
    <Card className="flex min-h-0 overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="shrink-0 border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <IconTimelineEvent className="h-4 w-4" />
            {t("sessions.timeline")}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {visibleMarkers.length
              ? t("sessions.timelineDescription", {
                  count: String(visibleMarkers.length),
                })
              : t("sessions.noTimelineEvents")}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {visibleMarkers.length ? (
            <div className="divide-y">
              {visibleMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={cn(
                    "flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                    marker.id === activeMarkerId && "bg-muted",
                  )}
                  onClick={() => onSeek(marker.offsetMs)}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                      marker.kind === "navigation" &&
                        "border-amber-500/35 bg-amber-500/10 text-amber-500",
                      marker.kind === "input" &&
                        "border-emerald-500/35 bg-emerald-500/10 text-emerald-500",
                      marker.kind === "click" &&
                        "border-sky-500/35 bg-sky-500/10 text-sky-500",
                      marker.kind === "custom" &&
                        "border-violet-500/35 bg-violet-500/10 text-violet-500",
                    )}
                  >
                    <MarkerIcon kind={marker.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {marker.label}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatClock(marker.offsetMs)}
                      </span>
                    </span>
                    {marker.detail ? (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {marker.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {t("sessions.noTimelineEvents")}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MarkerIcon({ kind }: { kind: ReplayMarker["kind"] }) {
  if (kind === "navigation") return <IconRoute className="h-4 w-4" />;
  if (kind === "input") return <IconKeyboard className="h-4 w-4" />;
  if (kind === "click") return <IconMouse className="h-4 w-4" />;
  return <IconTimelineEvent className="h-4 w-4" />;
}

function DetailSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
      <Skeleton className="h-full min-h-[420px] w-full" />
      <Skeleton className="h-full min-h-[420px] w-full" />
    </div>
  );
}

function useReplayEvents(
  response: SessionReplayEventsResponse,
): AnyReplayEvent[] {
  return useMemo(
    () =>
      sanitizeReplayEvents(
        response.chunks
          .flatMap((chunk) => chunk.events)
          .filter((event) => event && typeof event === "object"),
      ),
    [response.chunks],
  );
}

export function sanitizeReplayEvents(events: unknown[]): AnyReplayEvent[] {
  return events
    .map((event) => sanitizeReplayEvent(event))
    .filter((event): event is AnyReplayEvent => Boolean(event))
    .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
}

function sanitizeReplayEvent(event: unknown): AnyReplayEvent | null {
  if (!isRecord(event)) return null;
  let copy: AnyReplayEvent;
  try {
    copy = JSON.parse(JSON.stringify(event));
  } catch {
    copy = { ...event };
  }
  if (copy.type === RRWEB_EVENT_TYPE.FullSnapshot && isRecord(copy.data)) {
    const node = sanitizeSerializedNode(copy.data.node);
    if (!node) return null;
    copy.data.node = node;
  }
  if (
    copy.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
    copy.data?.source === INCREMENTAL_SOURCE.Mutation &&
    isRecord(copy.data)
  ) {
    copy.data = sanitizeMutationData(copy.data);
  }
  return copy;
}

function sanitizeMutationData(data: AnyRecord): AnyRecord {
  const next = { ...data };
  if (Array.isArray(next.adds)) {
    next.adds = next.adds
      .map((add) => {
        if (!isRecord(add)) return add;
        const node = sanitizeSerializedNode(add.node);
        if (!node) return null;
        return { ...add, node };
      })
      .filter(Boolean);
  }
  if (Array.isArray(next.attributes)) {
    next.attributes = next.attributes.map((attributeMutation) => {
      if (
        !isRecord(attributeMutation) ||
        !isRecord(attributeMutation.attributes)
      ) {
        return attributeMutation;
      }
      return {
        ...attributeMutation,
        attributes: sanitizeAttributes(attributeMutation.attributes),
      };
    });
  }
  if (Array.isArray(next.texts)) {
    next.texts = next.texts.map((textMutation) => {
      if (!isRecord(textMutation)) return textMutation;
      const copy = { ...textMutation };
      if (
        typeof copy.value === "string" &&
        containsStylesheetNetworkLoad(copy.value)
      ) {
        copy.value = "";
      }
      if (
        typeof copy.textContent === "string" &&
        containsStylesheetNetworkLoad(copy.textContent)
      ) {
        copy.textContent = "";
      }
      return copy;
    });
  }
  return next;
}

function sanitizeSerializedNode(node: unknown): AnyRecord | null {
  if (!isRecord(node)) return node as AnyRecord;
  const next: AnyRecord = { ...node };
  const tagName =
    typeof next.tagName === "string" ? next.tagName.toLowerCase() : "";
  if (next.type === 2 && tagName === "script") {
    return {
      ...next,
      tagName: "noscript",
      attributes: {},
      childNodes: [],
    };
  }
  if (next.type === 2 && tagName === "style") {
    return {
      ...next,
      attributes: isRecord(next.attributes)
        ? sanitizeAttributes(next.attributes)
        : {},
      childNodes: [],
    };
  }
  if (
    next.type === 3 &&
    typeof next.textContent === "string" &&
    containsStylesheetNetworkLoad(next.textContent)
  ) {
    next.textContent = "";
  }
  if (
    next.type === 2 &&
    tagName === "link" &&
    isScriptLikeLink(next.attributes)
  ) {
    return null;
  }
  if (isRecord(next.attributes)) {
    next.attributes = sanitizeAttributes(next.attributes);
  }
  if (Array.isArray(next.childNodes)) {
    next.childNodes = next.childNodes
      .map((child) => sanitizeSerializedNode(child))
      .filter(Boolean);
  }
  return next;
}

function containsStylesheetNetworkLoad(value: string): boolean {
  return /@import\b/i.test(value) || /\burl\s*\(/i.test(value);
}

function sanitizeAttributes(attributes: AnyRecord): AnyRecord {
  const next: AnyRecord = {};
  for (const [key, value] of Object.entries(attributes)) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("on")) continue;
    if (normalized === "srcdoc") continue;
    if (isReplayResourceAttribute(normalized)) continue;
    if (normalized === "style" && /\burl\s*\(/i.test(String(value))) continue;
    next[key] = value;
  }
  return next;
}

function isReplayResourceAttribute(name: string): boolean {
  return (
    name === "src" ||
    name === "srcset" ||
    name === "href" ||
    name === "xlink:href" ||
    name === "poster" ||
    name === "data" ||
    name === "action" ||
    name === "formaction" ||
    name === "background" ||
    name === "cite"
  );
}

function isScriptLikeLink(attributes: unknown): boolean {
  if (!isRecord(attributes)) return false;
  const rel = String(attributes.rel ?? "").toLowerCase();
  const as = String(attributes.as ?? "").toLowerCase();
  const href = String(attributes.href ?? "").toLowerCase();
  return (
    rel === "modulepreload" ||
    (rel === "preload" && as === "script") ||
    (rel === "prefetch" && href.endsWith(".js"))
  );
}

function buildReplayMarkers(events: AnyReplayEvent[]): ReplayMarker[] {
  const startedAt = replayStartedAt(events);
  const markers: ReplayMarker[] = [];
  for (const event of events) {
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    if (
      event.type === RRWEB_EVENT_TYPE.Meta &&
      typeof event.data?.href === "string"
    ) {
      const href = event.data.href;
      markers.push({
        id: `nav-${timestamp}-${markers.length}`,
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "navigation",
        label: pathLabel(href),
        detail: href,
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Input
    ) {
      markers.push({
        id: `input-${timestamp}-${markers.length}`,
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "input",
        label: "Input",
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.MouseInteraction &&
      (event.data?.type === MOUSE_INTERACTION.Click ||
        event.data?.type === MOUSE_INTERACTION.DblClick ||
        event.data?.type === MOUSE_INTERACTION.Focus)
    ) {
      markers.push({
        id: `click-${timestamp}-${markers.length}`,
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "click",
        label: event.data?.type === MOUSE_INTERACTION.Focus ? "Focus" : "Click",
      });
    } else if (event.type === RRWEB_EVENT_TYPE.Custom) {
      markers.push({
        id: `custom-${timestamp}-${markers.length}`,
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "custom",
        label: String(event.data?.tag ?? "Custom event"),
        detail:
          typeof event.data?.payload?.message === "string"
            ? event.data.payload.message
            : undefined,
      });
    }
  }
  return markers.sort((a, b) => a.offsetMs - b.offsetMs);
}

function buildIdleSkipRanges(events: AnyReplayEvent[]): SkipRange[] {
  const startedAt = replayStartedAt(events);
  const interactions: number[] = [];
  let lastTimestamp = startedAt;
  for (const event of events) {
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    lastTimestamp = Math.max(lastTimestamp, timestamp);
    if (event.type === RRWEB_EVENT_TYPE.Meta) {
      interactions.push(timestamp);
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      typeof event.data?.source === "number" &&
      INTERACTION_SOURCES.has(event.data.source)
    ) {
      interactions.push(timestamp);
    }
  }
  interactions.sort((a, b) => a - b);
  const ranges: SkipRange[] = [];
  for (let index = 1; index < interactions.length; index += 1) {
    pushIdleRange(
      ranges,
      interactions[index - 1],
      interactions[index],
      startedAt,
    );
  }
  if (interactions.length) {
    pushIdleRange(
      ranges,
      interactions[interactions.length - 1],
      lastTimestamp,
      startedAt,
    );
  }
  return ranges;
}

function pushIdleRange(
  ranges: SkipRange[],
  fromTs: number,
  toTs: number,
  startedAt: number,
) {
  if (toTs - fromTs < MIN_IDLE_SKIP_MS) return;
  const startMs = Math.max(0, fromTs - startedAt + IDLE_EDGE_PAD_MS);
  const endMs = Math.max(0, toTs - startedAt - IDLE_EDGE_PAD_MS);
  if (endMs - startMs >= MIN_IDLE_SKIP_MS - IDLE_EDGE_PAD_MS * 2) {
    ranges.push({ startMs, endMs });
  }
}

function currentUrlAt(events: AnyReplayEvent[], currentTime: number): string {
  const startedAt = replayStartedAt(events);
  let current = "";
  for (const event of events) {
    if (event.type !== RRWEB_EVENT_TYPE.Meta) continue;
    if (typeof event.data?.href !== "string") continue;
    const offset = Number(event.timestamp ?? 0) - startedAt;
    if (offset <= currentTime + 50) current = event.data.href;
    else break;
  }
  return current;
}

function replayStartedAt(events: AnyReplayEvent[]): number {
  const first = events.find((event) =>
    Number.isFinite(Number(event.timestamp)),
  );
  return Number(first?.timestamp ?? 0);
}

function replayDuration(events: AnyReplayEvent[]): number {
  const startedAt = replayStartedAt(events);
  let endedAt = startedAt;
  for (const event of events) {
    endedAt = Math.max(endedAt, Number(event.timestamp ?? 0));
  }
  return Math.max(0, endedAt - startedAt);
}

function pathLabel(href: string): string {
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
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

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function useLiveRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
