import {
  AgentToggleButton,
  appApiPath,
  callAction,
  PromptComposer,
  useActionMutation,
  useSendToAgentChat,
  useT,
} from "@agent-native/core/client";
import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "@shared/session-replay-agent-access";
import {
  isFailedSessionReplayNetworkStatus,
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "@shared/session-replay-diagnostics";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconCopy,
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
  IconSearch,
  IconTerminal2,
  IconTimelineEvent,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { getIdToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

import { extractReplayDiagnostics } from "./session-replay-devtools";
import type { ReplayDevToolsDiagnostics } from "./session-replay-devtools";
import {
  type SessionIssueMatch,
  SessionDevToolsPanel,
} from "./SessionDevToolsPanel";

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

type SessionReplayManifestResponse = {
  recording: SessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    startedAt: string | null;
    endedAt: string | null;
    bytesPath: string;
  }>;
};

type SessionReplayPlaybackResponse = {
  recording: SessionRecordingSummary;
  chunks: ReplayChunkEvents[];
  eventCount: number;
  truncated: boolean;
  unavailableChunks: number;
  loadedChunks: number;
  totalChunks: number;
  loadedBytes: number;
  totalBytes: number;
  isComplete: boolean;
};

type AnyReplayEvent = Record<string, any>;
type AnyRecord = Record<string, any>;

type ReplayPlayerStatus = "idle" | "loading" | "ready" | "error";

type ReplayMarker = {
  id: string;
  offsetMs: number;
  timestamp: number;
  kind: "navigation" | "input" | "click" | "console" | "custom";
  label: string;
  detail?: string;
  severity?: "info" | "warn" | "error";
  fields?: Array<{ label: string; value: string }>;
};

type SkipRange = {
  startMs: number;
  endMs: number;
};

type ReplayViewportDimensions = {
  width: number;
  height: number;
};

const DEFAULT_PLAYER_WIDTH = 1024;
const DEFAULT_PLAYER_HEIGHT = 640;
const DEFAULT_SPEED = 2;
const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];
const SKIP_STEP_MS = 5000;
const MIN_IDLE_SKIP_MS = 8000;
const IDLE_EDGE_PAD_MS = 1200;
const REPLAY_CHUNK_BATCH_MAX_CHUNKS = 20;
const REPLAY_CHUNK_BATCH_MAX_DECLARED_BYTES = 4 * 1024 * 1024;
const REPLAY_CHUNK_BATCH_FETCH_CONCURRENCY = 3;
const REPLAY_CHUNK_UNAVAILABLE_MESSAGE = "Session replay chunk is unavailable";
const SCROLL_MARKER_BURST_MS = 1_000;
const DEFAULT_DEVTOOLS_HEIGHT = 220;
const MIN_STAGE_HEIGHT_PX = 240;
const SCRUBBER_MARKER_LIMIT = 500;
const TIMELINE_MARKER_LIMIT = 300;
const TIMELINE_FOLLOW_PAUSE_MS = 4000;
/** Toast/snackbar noise only — keep insertStyleRules minimal like builder-internal. */
const SUPPRESS_OVERLAYS_CSS = [
  "[data-radix-popper-content-wrapper], .Toastify, [class*='toast'], [class*='Toast'], [class*='Snackbar'] { display: none !important; }",
];
type ReplayConsoleDiagnostics = ReturnType<
  typeof extractReplayDiagnostics
>["console"];

type ConsoleErrorSignaturePayload = {
  key: string;
  source: string;
  message: string;
  stack?: string;
};

/**
 * Distill the resolvable error lines from a session's console diagnostics for
 * issue matching. Only error-level lines are worth sending: window errors,
 * unhandled rejections, and manual `captureException` all surface at `error`
 * level with a serialized `Name: message` (+ stack) that the server can
 * fingerprint back to a captured issue. Non-error console lines are left alone,
 * and anything without a captured issue simply comes back unmatched.
 */
function buildConsoleErrorSignatures(
  entries: ReplayConsoleDiagnostics,
): ConsoleErrorSignaturePayload[] {
  const signatures: ConsoleErrorSignaturePayload[] = [];
  for (const entry of entries) {
    if (entry.level !== "error" || !entry.message) continue;
    signatures.push({
      key: entry.id,
      source: entry.source,
      message: entry.message,
      ...(entry.stack ? { stack: entry.stack } : {}),
    });
    if (signatures.length >= 100) break;
  }
  return signatures;
}

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
  ViewportResize: 4,
  Input: 5,
  TouchMove: 6,
} as const;

const MOUSE_INTERACTION = {
  MouseUp: 0,
  MouseDown: 1,
  Click: 2,
  ContextMenu: 3,
  DblClick: 4,
  Focus: 5,
  TouchStart: 7,
  TouchEnd: 9,
} as const;

export default function SessionDetailPage() {
  const t = useT();
  const { recordingId = "" } = useParams();
  const { codeRequiredDialog } = useSendToAgentChat();
  const { data, isLoading, error } = useSessionReplayPlayback(recordingId);
  const recording = data?.recording;

  return (
    <div className="analytics-session-detail-page flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden">
      {codeRequiredDialog}
      <div className="analytics-session-detail-header flex shrink-0 flex-col gap-3">
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
        {recording ? (
          <TooltipProvider>
            <div className="flex shrink-0 items-center gap-2">
              <CopySessionForAgentButton recordingId={recording.id} />
              <AskSessionPopover recording={recording} />
              <AgentToggleButton />
            </div>
          </TooltipProvider>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-destructive">
            <IconExclamationCircle className="h-5 w-5" />
            {t("sessions.loadFailed", {
              message: error instanceof Error ? error.message : String(error),
            })}
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

function CopySessionForAgentButton({ recordingId }: { recordingId: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const createLink = useActionMutation(
    "create-session-replay-agent-link" as any,
  );

  async function handleCopy() {
    if (createLink.isPending) return;
    const result = (await createLink.mutateAsync({
      recordingId,
    })) as { url?: string };
    if (!result?.url) return;
    await navigator.clipboard.writeText(result.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleCopy()}
          disabled={createLink.isPending}
        >
          {copied ? (
            <IconCheck className="h-4 w-4" />
          ) : (
            <IconCopy className="h-4 w-4" />
          )}
          {copied ? t("sessions.copiedForAgent") : t("sessions.copyForAgent")}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("sessions.copyForAgentTooltip")}</TooltipContent>
    </Tooltip>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" disabled={isGenerating}>
              <IconMessageCircle className="h-4 w-4" />
              {t("sessions.askAgent")}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("sessions.askAgentTooltip")}</TooltipContent>
      </Tooltip>
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
  response: SessionReplayPlaybackResponse;
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
    <div className="analytics-session-detail-workbench grid h-full min-h-0 gap-3">
      <ReplayPlayer
        events={events}
        markers={markers}
        response={response}
        onTimeUpdate={setCurrentTime}
        registerSeek={registerSeek}
      />
      <ReplayTimeline
        markers={markers}
        isLoading={!response.isComplete}
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
  response: SessionReplayPlaybackResponse;
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
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [devToolsHeight, setDevToolsHeight] = useState(DEFAULT_DEVTOOLS_HEIGHT);
  const [maxDevToolsHeight, setMaxDevToolsHeight] = useState(420);
  const playerShellRef = useRef<HTMLDivElement>(null);
  const [streamedDims, setStreamedDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const initialDims = useMemo(() => replayViewportDimensions(events), [events]);
  const eventsRef = useLiveRef(events);
  // Stable identity for the loaded event set so progressive chunk publishes
  // that only grow the array do not tear down a healthy Replayer mid-playback.
  const eventsIdentity = useMemo(
    () =>
      `${events.length}:${Number(events[0]?.timestamp ?? 0)}:${Number(
        events[events.length - 1]?.timestamp ?? 0,
      )}`,
    [events],
  );
  const scrubbingRef = useRef(false);
  const scrubResumePlayingRef = useRef(false);

  // Keep the stage in rrweb's coordinate system. Clamping only this outer
  // wrapper while rrweb keeps its raw iframe dimensions clips and stretches
  // wide recordings because the two layers no longer share a viewport.
  const playerWidth =
    streamedDims?.width ?? initialDims?.width ?? DEFAULT_PLAYER_WIDTH;
  const playerHeight =
    streamedDims?.height ?? initialDims?.height ?? DEFAULT_PLAYER_HEIGHT;
  const skipRanges = useMemo(() => buildIdleSkipRanges(events), [events]);
  const skipRangesRef = useLiveRef(skipRanges);
  const skipInactiveRef = useLiveRef(skipInactive);
  const currentTimeRef = useLiveRef(currentTime);
  const playingRef = useLiveRef(playing);
  const speedRef = useLiveRef(speed);

  const currentUrl = useMemo(
    () => currentUrlAt(events, currentTime),
    [events, currentTime],
  );
  const diagnostics = useMemo(() => extractReplayDiagnostics(events), [events]);
  const devToolsIssueCount = replayDevToolsIssueCount(
    diagnostics,
    response.isComplete,
  );

  // Resolve captured console errors in this replay to their Sentry-style issue
  // groups (one batched, access-scoped call, server-computed fingerprints) so
  // each error can deep-link to its full issue detail. Only runs once devtools
  // are open and there is at least one error line worth looking up.
  const errorSignatures = useMemo(
    () => buildConsoleErrorSignatures(diagnostics.console),
    [diagnostics.console],
  );
  const errorSignaturesKey = useMemo(
    () => JSON.stringify(errorSignatures),
    [errorSignatures],
  );
  const recordingId = response.recording.id;
  const issueMatchQuery = useQuery({
    queryKey: ["match-error-issues", recordingId, errorSignaturesKey],
    queryFn: () =>
      callAction<Record<string, SessionIssueMatch>>(
        "match-error-issues",
        { signatures: errorSignatures },
        { method: "POST" },
      ),
    enabled: devToolsOpen && errorSignatures.length > 0,
    staleTime: 60_000,
  });
  const issueMatches = useMemo(() => {
    const map = new Map<string, SessionIssueMatch>();
    const data = issueMatchQuery.data;
    if (data) {
      for (const [key, value] of Object.entries(data)) map.set(key, value);
    }
    return map;
  }, [issueMatchQuery.data]);
  const loadingPercent =
    response.totalChunks > 0
      ? clamp(response.loadedChunks / response.totalChunks, 0, 1)
      : response.isComplete
        ? 1
        : 0;

  useEffect(() => {
    const el = stageAreaRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.min(
        1,
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

  // Keep Dev Tools from eating the stage. On short viewports the panel used to
  // shrink the replay area into a ribbon even when Meta dimensions were fine.
  useEffect(() => {
    const el = playerShellRef.current;
    if (!el) return;
    const update = () => {
      const chromeBudget = 140;
      const available = Math.max(
        160,
        el.clientHeight - MIN_STAGE_HEIGHT_PX - chromeBudget,
      );
      setMaxDevToolsHeight(available);
      setDevToolsHeight((current) => Math.min(current, available));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [devToolsOpen]);

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

  const beginScrub = useCallback(
    (ms: number) => {
      if (!scrubbingRef.current) {
        scrubResumePlayingRef.current = playingRef.current;
      }
      scrubbingRef.current = true;
      seek(ms, false);
    },
    [playingRef, seek],
  );

  const endScrub = useCallback(
    (ms: number) => {
      const resume = scrubResumePlayingRef.current;
      scrubbingRef.current = false;
      scrubResumePlayingRef.current = false;
      seek(ms, resume);
    },
    [seek],
  );

  useEffect(() => {
    registerSeek(seek);
  }, [registerSeek, seek]);

  useEffect(() => {
    if (!stageRootRef.current) return;
    let cancelled = false;
    let localReplayer: any = null;

    async function loadReplay() {
      // Wait for the full recording before creating the Replayer. Progressive
      // chunk publishes used to rebuild the player on every append, which
      // reset the clock, disabled the scrubber, and desynced the playhead.
      const replayEvents = eventsRef.current;
      if (!response.isComplete) {
        setStatus("loading");
        setError(null);
        setPlaying(false);
        return;
      }
      if (replayEvents.length < 2) {
        throw new Error(t("sessions.noReplayEvents"));
      }
      if (
        !replayEvents.some(
          (event) => event.type === RRWEB_EVENT_TYPE.FullSnapshot,
        )
      ) {
        throw new Error(t("sessions.noReplayEvents"));
      }
      if (!hasPlayableReplayEvents(replayEvents)) {
        throw new Error(t("sessions.noReplayEvents"));
      }
      setStatus("loading");
      setError(null);
      await import("@rrweb/replay/dist/style.css");
      const { Replayer } = await import("@rrweb/replay");
      if (cancelled || !stageRootRef.current) return;

      stageRootRef.current.innerHTML = "";
      // Match builder-internal: pass events through untouched and let rrweb own
      // iframe sizing via Meta / ViewportResize. Only use dimensions for CSS
      // fit-to-stage scaling of the outer wrapper — never rewrite Meta or force
      // iframe width/height (that mismatches the FullSnapshot DOM and blanks
      // the stage).
      setStreamedDims(replayViewportDimensions(replayEvents));
      localReplayer = new Replayer(replayEvents as any[], {
        root: stageRootRef.current,
        speed: speedRef.current,
        skipInactive: false,
        showWarning: false,
        showDebug: false,
        triggerFocus: false,
        mouseTail: false,
        insertStyleRules: SUPPRESS_OVERLAYS_CSS,
      });
      replayerRef.current = localReplayer;
      const meta = localReplayer.getMetaData?.();
      const total = Number(meta?.totalTime ?? replayDuration(replayEvents));
      setTotalTime(Number.isFinite(total) ? total : 0);
      const startAt = clamp(
        currentTimeRef.current,
        0,
        Number.isFinite(total) ? total : 0,
      );
      localReplayer.on?.("finish", () => {
        setPlaying(false);
        const finalTime = Number(localReplayer.getCurrentTime?.() ?? total);
        updateTime(Number.isFinite(finalTime) ? finalTime : total);
      });
      localReplayer.on?.("resize", (payload: unknown) => {
        const dims = payload as { width?: unknown; height?: unknown };
        if (
          typeof dims.width === "number" &&
          typeof dims.height === "number" &&
          Number.isFinite(dims.width) &&
          Number.isFinite(dims.height) &&
          dims.width > 0 &&
          dims.height > 0
        ) {
          setStreamedDims({
            width: Math.round(dims.width),
            height: Math.round(dims.height),
          });
        }
      });
      updateTime(startAt);
      setStatus("ready");
      try {
        localReplayer.play?.(startAt);
        setPlaying(true);
      } catch (autoplayError) {
        console.warn("[session-replay] autoplay failed", autoplayError);
        try {
          localReplayer.pause?.(startAt);
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
    // Key only on isComplete + a stable events identity. Including the events
    // array reference would rebuild the Replayer when the final publish()
    // replaces the chunks object even though the event set is unchanged.
  }, [
    currentTimeRef,
    eventsIdentity,
    eventsRef,
    response.isComplete,
    speedRef,
    t,
    updateTime,
  ]);

  useEffect(() => {
    if (!playing || status !== "ready") {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = () => {
      const replayer = replayerRef.current;
      if (replayer && !scrubbingRef.current) {
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
      <div
        ref={playerShellRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <Card className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col p-0">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/20 p-2">
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
                  "relative min-h-[200px] flex-1 overflow-hidden border bg-white dark:bg-zinc-950",
                  currentUrl ? "rounded-b-md" : "rounded-md",
                  !devToolsOpen && "min-h-[320px]",
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
                  aria-label={
                    playing ? t("sessions.pause") : t("sessions.play")
                  }
                  onClick={togglePlay}
                />
                {status === "loading" ? (
                  <div className="absolute inset-0 z-30 grid place-items-center bg-background/70 p-6 text-center text-sm text-muted-foreground">
                    <div className="w-full max-w-sm">
                      <p>{t("sessions.replayLoading")}</p>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{
                            width: `${Math.round(loadingPercent * 100)}%`,
                          }}
                        />
                      </div>
                      {response.totalChunks > 0 ? (
                        <p className="mt-2 font-mono text-[11px]">
                          {t("sessions.replayLoadingProgress", {
                            loaded: String(response.loadedChunks),
                            total: String(response.totalChunks),
                          })}
                        </p>
                      ) : null}
                    </div>
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
                onScrub={beginScrub}
                onScrubEnd={endScrub}
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

              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors hover:bg-muted",
                  devToolsOpen &&
                    "border-primary/40 bg-primary/10 text-primary",
                  !response.isComplete && "cursor-not-allowed opacity-50",
                )}
                onClick={() => setDevToolsOpen((value) => !value)}
                disabled={!response.isComplete}
                aria-pressed={devToolsOpen}
                aria-expanded={devToolsOpen}
              >
                <IconTerminal2 className="h-4 w-4" />
                {t("sessions.devtools")}
                {devToolsIssueCount > 0 ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[10px] font-semibold leading-none text-white"
                    aria-label={t("sessions.devtoolsIssueCount", {
                      count: String(devToolsIssueCount),
                    })}
                  >
                    {devToolsIssueCount > 99 ? "99+" : devToolsIssueCount}
                  </span>
                ) : null}
              </button>

              {response.isComplete ? (
                <span className="ms-auto hidden text-xs text-muted-foreground lg:inline">
                  {t("sessions.replayEventCount", {
                    events: String(response.eventCount),
                  })}
                  {response.truncated ? ` ${t("sessions.truncated")}` : ""}
                </span>
              ) : null}
            </div>

            {devToolsOpen ? (
              <SessionDevToolsPanel
                diagnostics={diagnostics}
                currentTime={currentTime}
                height={Math.min(devToolsHeight, maxDevToolsHeight)}
                maxHeight={maxDevToolsHeight}
                onHeightChange={setDevToolsHeight}
                onSeek={(ms) => seek(ms, true)}
                issueMatches={issueMatches}
                issueMatching={issueMatchQuery.isFetching}
              />
            ) : null}

            {response.unavailableChunks > 0 ? (
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                {t("sessions.unavailableChunks", {
                  count: String(response.unavailableChunks),
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
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
  onScrub,
  onScrubEnd,
}: {
  currentTime: number;
  totalTime: number;
  markers: ReplayMarker[];
  skipRanges: SkipRange[];
  skipInactive: boolean;
  disabled: boolean;
  onScrub: (ms: number) => void;
  onScrubEnd: (ms: number) => void;
}) {
  const t = useT();
  const scrubberMarkers = useMemo(
    () => visibleScrubberMarkers(markers, totalTime),
    [markers, totalTime],
  );

  function handleScrub(event: FormEvent<HTMLInputElement>) {
    onScrub(Number(event.currentTarget.value));
  }

  return (
    <div className="relative min-h-8 min-w-[180px] flex-1">
      <input
        type="range"
        className="an-replay-scrub absolute left-0 top-1/2 z-20 w-full -translate-y-1/2"
        min={0}
        max={Math.max(0, totalTime)}
        step={50}
        value={Math.min(currentTime, Math.max(totalTime, 0))}
        disabled={disabled}
        onInput={handleScrub}
        onChange={handleScrub}
        onPointerUp={(event) =>
          onScrubEnd(Number((event.target as HTMLInputElement).value))
        }
        onKeyUp={(event) =>
          onScrubEnd(Number((event.target as HTMLInputElement).value))
        }
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
                "absolute top-0 h-full rounded-full bg-amber-400 transition-opacity",
                skipInactive ? "opacity-50" : "opacity-20",
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 h-5 -translate-y-1/2">
        {scrubberMarkers.map((marker) => {
          const left = totalTime > 0 ? (marker.offsetMs / totalTime) * 100 : 0;
          return (
            <span
              key={marker.id}
              className={cn(
                "absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-90 ring-1 ring-background/80",
                marker.kind === "navigation"
                  ? "bg-amber-500"
                  : marker.kind === "input"
                    ? "bg-emerald-500"
                    : marker.kind === "click"
                      ? "bg-sky-500"
                      : marker.kind === "console"
                        ? marker.severity === "error"
                          ? "bg-red-500"
                          : marker.severity === "warn"
                            ? "bg-amber-500"
                            : "bg-slate-400"
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
  isLoading,
  activeMarkerId,
  onSeek,
}: {
  markers: ReplayMarker[];
  isLoading: boolean;
  activeMarkerId: string | null;
  onSeek: (ms: number) => void;
}) {
  const t = useT();
  const [expandedMarkerId, setExpandedMarkerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const lastManualScrollAtRef = useRef(0);
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  const filteredMarkers = useMemo(
    () => filterReplayMarkers(markers, query).slice(0, TIMELINE_MARKER_LIMIT),
    [markers, query],
  );

  useEffect(() => {
    if (!activeMarkerId) return;
    if (Date.now() - lastManualScrollAtRef.current < TIMELINE_FOLLOW_PAUSE_MS) {
      return;
    }
    const row = activeRowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (
      rowTop >= list.scrollTop &&
      rowBottom <= list.scrollTop + list.clientHeight
    ) {
      return;
    }
    list.scrollTo({
      top: Math.max(0, rowTop - list.clientHeight / 3),
      behavior: "smooth",
    });
  }, [activeMarkerId, filteredMarkers]);

  return (
    <Card className="analytics-session-detail-timeline min-h-0 min-w-0 overflow-hidden">
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col p-0">
        <div className="min-w-0 shrink-0 space-y-2 border-b px-3 py-2">
          <div className="truncate text-sm font-semibold">
            {t("sessions.timeline")}
          </div>
          {!isLoading || markers.length ? (
            <div className="relative">
              <IconSearch className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="h-7 ps-7 text-xs"
                value={query}
                placeholder={t("sessions.timelineSearch")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
        </div>
        <div
          ref={listRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          onWheel={() => {
            lastManualScrollAtRef.current = Date.now();
          }}
          onPointerDown={() => {
            lastManualScrollAtRef.current = Date.now();
          }}
        >
          {filteredMarkers.length ? (
            <div className="min-w-0 divide-y">
              {filteredMarkers.map((marker) => {
                const expanded = marker.id === expandedMarkerId;
                const active = marker.id === activeMarkerId;
                return (
                  <div
                    key={marker.id}
                    ref={active ? activeRowRef : undefined}
                    className={cn(
                      "transition-colors duration-300",
                      active && "bg-primary/[0.06] dark:bg-primary/[0.09]",
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full min-w-0 gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                      aria-expanded={expanded}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        onSeek(marker.offsetMs);
                        setExpandedMarkerId((current) =>
                          current === marker.id ? null : marker.id,
                        );
                      }}
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
                          marker.kind === "console" &&
                            marker.severity !== "error" &&
                            "border-slate-500/35 bg-slate-500/10 text-slate-400",
                          marker.kind === "console" &&
                            marker.severity === "error" &&
                            "border-red-500/35 bg-red-500/10 text-red-500",
                          marker.kind === "custom" &&
                            "border-violet-500/35 bg-violet-500/10 text-violet-500",
                        )}
                      >
                        <MarkerIcon kind={marker.kind} />
                      </span>
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="flex min-w-0 items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium">
                            {marker.label}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {formatClock(marker.offsetMs)}
                          </span>
                        </span>
                        {marker.detail ? (
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {marker.detail}
                          </span>
                        ) : null}
                      </span>
                      <IconChevronRight
                        className={cn(
                          "mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100",
                          expanded && "rotate-90 rtl:scale-x-100",
                        )}
                      />
                    </button>
                    {expanded ? <MarkerDetail marker={marker} /> : null}
                  </div>
                );
              })}
            </div>
          ) : isLoading ? null : (
            <div className="p-4 text-sm text-muted-foreground">
              {query.trim()
                ? t("sessions.timelineNoMatches")
                : t("sessions.noTimelineEvents")}
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
  if (kind === "console") return <IconTerminal2 className="h-4 w-4" />;
  return <IconTimelineEvent className="h-4 w-4" />;
}

function MarkerDetail({ marker }: { marker: ReplayMarker }) {
  return (
    <div className="space-y-2 border-t bg-muted/25 px-3 py-2 ps-12">
      {marker.detail ? (
        <p className="break-words text-xs text-muted-foreground">
          {marker.detail}
        </p>
      ) : null}
      {marker.fields?.length ? (
        <dl className="grid gap-2 text-xs">
          {marker.fields.map((field) => (
            <div key={`${marker.id}-${field.label}`} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {field.label}
              </dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-foreground/80">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="analytics-session-detail-workbench grid min-h-0 flex-1 gap-3">
      <Skeleton className="h-full min-h-[420px] w-full" />
      <Skeleton className="analytics-session-detail-timeline h-full min-h-[420px] w-full" />
    </div>
  );
}

function useSessionReplayPlayback(recordingId: string) {
  const agentAccessToken = currentSessionReplayAgentAccessToken();
  const [state, setState] = useState<{
    data: SessionReplayPlaybackResponse | null;
    isLoading: boolean;
    error: Error | null;
  }>({
    data: null,
    isLoading: Boolean(recordingId),
    error: null,
  });

  useEffect(() => {
    if (!recordingId) {
      setState({ data: null, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: null, isLoading: true, error: null });

    async function loadProgressively() {
      try {
        const manifest = await fetchReplayManifest(recordingId, {
          agentAccessToken,
        });
        if (cancelled) return;

        const loadedChunks = new Array<ReplayChunkEvents | undefined>(
          manifest.chunks.length,
        );
        let loadedCount = 0;
        let loadedBytes = 0;
        let unavailableChunks = 0;
        const chunkIndexBySeq = new Map(
          manifest.chunks.map((chunk, index) => [chunk.seq, index]),
        );

        const publish = (force = false) => {
          const complete = loadedCount >= manifest.chunks.length;
          const chunks = loadedChunks.filter(
            (chunk): chunk is ReplayChunkEvents => Boolean(chunk),
          );
          // Only hand events to the player once every chunk is in. Partial
          // publishes used to rebuild the Replayer mid-playback and break the
          // scrubber; the loading bar still updates while chunks stream in.
          const shouldPublishEvents = force || complete;

          if (shouldPublishEvents) {
            setState({
              data: playbackResponseFromChunks(manifest, chunks, {
                isComplete: complete,
                loadedChunks: loadedCount,
                loadedBytes,
                unavailableChunks,
              }),
              isLoading: false,
              error: null,
            });
            return;
          }

          setState((current) => ({
            data: current.data
              ? {
                  ...current.data,
                  loadedChunks: loadedCount,
                  loadedBytes,
                  unavailableChunks,
                }
              : playbackResponseFromChunks(manifest, [], {
                  isComplete: complete,
                  loadedChunks: loadedCount,
                  loadedBytes,
                  unavailableChunks,
                }),
            // Keep the page shell mounted so the player loading bar can show
            // chunk progress; the Replayer itself still waits for isComplete.
            isLoading: false,
            error: null,
          }));
        };

        publish();

        await fetchReplayChunks(
          manifest.chunks,
          { agentAccessToken },
          (batch) => {
            for (const chunk of batch) {
              const index = chunkIndexBySeq.get(chunk.seq);
              if (index === undefined || loadedChunks[index]) continue;
              loadedChunks[index] = chunk;
              loadedCount += 1;
              loadedBytes += manifest.chunks[index].byteLength;
              if (chunk.unavailable) unavailableChunks += 1;
            }
            if (!cancelled) publish();
          },
        );
        if (!cancelled) publish(true);
      } catch (loadError) {
        if (cancelled) return;
        cancelled = true;
        setState({
          data: null,
          isLoading: false,
          error:
            loadError instanceof Error
              ? loadError
              : new Error(String(loadError)),
        });
      }
    }

    void loadProgressively();
    return () => {
      cancelled = true;
    };
  }, [agentAccessToken, recordingId]);

  return state;
}

interface FetchSessionReplayPlaybackOptions {
  agentAccessToken?: string;
}

export async function fetchSessionReplayPlayback(
  recordingId: string,
  options: FetchSessionReplayPlaybackOptions = {},
): Promise<SessionReplayPlaybackResponse> {
  const manifest = await fetchReplayManifest(recordingId, options);
  const chunks = await fetchReplayChunks(manifest.chunks, options);
  const unavailableChunks = chunks.filter((chunk) => chunk.unavailable).length;
  const loadedBytes = manifest.chunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0,
  );
  return playbackResponseFromChunks(manifest, chunks, {
    isComplete: true,
    loadedChunks: chunks.length,
    loadedBytes,
    unavailableChunks,
  });
}

function playbackResponseFromChunks(
  manifest: SessionReplayManifestResponse,
  chunks: ReplayChunkEvents[],
  progress: {
    isComplete: boolean;
    loadedChunks: number;
    loadedBytes: number;
    unavailableChunks: number;
  },
): SessionReplayPlaybackResponse {
  const eventCount = chunks.reduce(
    (sum, chunk) => sum + chunk.events.length,
    0,
  );
  const totalBytes = manifest.chunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0,
  );
  return {
    recording: manifest.recording,
    chunks,
    eventCount,
    truncated: false,
    unavailableChunks: progress.unavailableChunks,
    loadedChunks: progress.loadedChunks,
    totalChunks: manifest.chunks.length,
    loadedBytes: progress.loadedBytes,
    totalBytes,
    isComplete: progress.isComplete,
  };
}

async function fetchReplayManifest(
  recordingId: string,
  options: FetchSessionReplayPlaybackOptions,
): Promise<SessionReplayManifestResponse> {
  const response = await fetchReplayApi(
    `/api/session-replay/recordings/${encodeURIComponent(
      recordingId,
    )}/manifest`,
    options.agentAccessToken,
  );
  if (!response.ok) throw await replayFetchError(response);
  return (await response.json()) as SessionReplayManifestResponse;
}

async function fetchReplayChunks(
  chunks: SessionReplayManifestResponse["chunks"],
  options: FetchSessionReplayPlaybackOptions,
  onBatch?: (chunks: ReplayChunkEvents[]) => void,
): Promise<ReplayChunkEvents[]> {
  const results = new Array<ReplayChunkEvents>(chunks.length);
  const indexBySeq = new Map(chunks.map((chunk, index) => [chunk.seq, index]));
  const batches = partitionReplayChunkBatches(chunks);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < batches.length) {
      const index = nextIndex;
      nextIndex += 1;
      const loaded = await fetchReplayChunkBatch(batches[index], options);
      for (const chunk of loaded) {
        const resultIndex = indexBySeq.get(chunk.seq);
        if (resultIndex !== undefined) results[resultIndex] = chunk;
      }
      onBatch?.(loaded);
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(REPLAY_CHUNK_BATCH_FETCH_CONCURRENCY, batches.length),
      },
      worker,
    ),
  );
  return results;
}

export function partitionReplayChunkBatches(
  chunks: SessionReplayManifestResponse["chunks"],
): Array<SessionReplayManifestResponse["chunks"]> {
  const batches: Array<SessionReplayManifestResponse["chunks"]> = [];
  let batch: SessionReplayManifestResponse["chunks"] = [];
  let declaredBytes = 0;

  for (const chunk of chunks) {
    const exceedsChunkLimit = batch.length >= REPLAY_CHUNK_BATCH_MAX_CHUNKS;
    const exceedsByteLimit =
      batch.length > 0 &&
      declaredBytes + chunk.byteLength > REPLAY_CHUNK_BATCH_MAX_DECLARED_BYTES;
    if (exceedsChunkLimit || exceedsByteLimit) {
      batches.push(batch);
      batch = [];
      declaredBytes = 0;
    }
    batch.push(chunk);
    declaredBytes += chunk.byteLength;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function fetchReplayChunkBatch(
  chunks: SessionReplayManifestResponse["chunks"],
  options: FetchSessionReplayPlaybackOptions,
): Promise<ReplayChunkEvents[]> {
  const recordingId = replayRecordingIdFromChunkPath(chunks[0]?.bytesPath);
  if (!recordingId) {
    return Promise.all(chunks.map((chunk) => fetchReplayChunk(chunk, options)));
  }
  const query = new URLSearchParams({
    seqs: chunks.map((chunk) => chunk.seq).join(","),
  });
  const response = await fetchReplayApi(
    `/api/session-replay/recordings/${encodeURIComponent(recordingId)}/chunks?${query}`,
    options.agentAccessToken,
  );
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      return Promise.all(
        chunks.map((chunk) => fetchReplayChunk(chunk, options)),
      );
    }
    throw await replayFetchError(response);
  }

  const payload = (await response.json()) as { chunks?: unknown };
  const returnedChunks = Array.isArray(payload?.chunks)
    ? payload.chunks.filter(isReplayChunkEvents)
    : [];
  const returnedBySeq = new Map(
    returnedChunks.map((chunk) => [chunk.seq, chunk]),
  );

  return Promise.all(
    chunks.map(async (manifestChunk) => {
      const loaded = returnedBySeq.get(manifestChunk.seq);
      return loaded ?? fetchReplayChunk(manifestChunk, options);
    }),
  );
}

function replayRecordingIdFromChunkPath(path: string | undefined): string {
  if (!path) return "";
  const match = path.match(/\/recordings\/([^/]+)\/chunks\//);
  return match ? decodeURIComponent(match[1]) : "";
}

function isReplayChunkEvents(value: unknown): value is ReplayChunkEvents {
  return (
    isRecord(value) &&
    typeof value.seq === "number" &&
    typeof value.checksum === "string" &&
    typeof value.byteLength === "number" &&
    typeof value.eventCount === "number" &&
    Array.isArray(value.events)
  );
}

async function fetchReplayChunk(
  chunk: SessionReplayManifestResponse["chunks"][number],
  options: FetchSessionReplayPlaybackOptions,
): Promise<ReplayChunkEvents> {
  const response = await fetchReplayApi(
    chunk.bytesPath,
    options.agentAccessToken,
  );
  if (!response.ok) {
    const error = await replayFetchError(response);
    if (isUnavailableReplayChunk(response, error)) {
      return replayUnavailableChunk(chunk);
    }
    throw error;
  }
  const payload = await response.json();
  return {
    seq: chunk.seq,
    checksum: chunk.checksum,
    byteLength: chunk.byteLength,
    eventCount: chunk.eventCount,
    events: replayPayloadEvents(payload),
  };
}

function isUnavailableReplayChunk(response: Response, error: Error): boolean {
  return (
    response.status === 404 &&
    error.message === REPLAY_CHUNK_UNAVAILABLE_MESSAGE
  );
}

function replayUnavailableChunk(
  chunk: SessionReplayManifestResponse["chunks"][number],
): ReplayChunkEvents {
  return {
    seq: chunk.seq,
    checksum: chunk.checksum,
    byteLength: chunk.byteLength,
    eventCount: chunk.eventCount,
    events: [],
    unavailable: true,
  };
}

function currentSessionReplayAgentAccessToken(): string {
  const browserSearch =
    globalThis.window?.location?.search ?? globalThis.location?.search ?? "";
  return (
    new URLSearchParams(browserSearch).get(SESSION_REPLAY_AGENT_ACCESS_PARAM) ??
    ""
  );
}

async function fetchReplayApi(
  path: string,
  explicitAgentAccessToken?: string,
): Promise<Response> {
  const token = await getIdToken();
  const browserOrigin =
    globalThis.window?.location?.origin ??
    globalThis.location?.origin ??
    "http://localhost";
  const url = new URL(appApiPath(path), browserOrigin);
  const agentAccessToken =
    explicitAgentAccessToken ?? currentSessionReplayAgentAccessToken();
  if (agentAccessToken) {
    url.searchParams.set(SESSION_REPLAY_AGENT_ACCESS_PARAM, agentAccessToken);
  }
  return fetch(`${url.pathname}${url.search}${url.hash}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function replayFetchError(response: Response): Promise<Error> {
  try {
    const payload = await response.json();
    if (isRecord(payload) && typeof payload.error === "string") {
      return new Error(payload.error);
    }
  } catch {
    // Fall through to the status text.
  }
  return new Error(response.statusText || `HTTP ${response.status}`);
}

export function replayPayloadEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.events)) {
    return payload.events;
  }
  return payload ? [payload] : [];
}

function useReplayEvents(
  response: SessionReplayPlaybackResponse,
): AnyReplayEvent[] {
  return useMemo(
    () =>
      normalizeReplayEvents(
        response.chunks
          .flatMap((chunk) => chunk.events)
          .filter((event) => event && typeof event === "object"),
      ),
    [response.chunks],
  );
}

const REPLAY_NETWORK_ATTRIBUTES = new Set([
  "src",
  "srcset",
  "poster",
  "background",
  "action",
  "formaction",
  "data",
  "ping",
  "cite",
  "xlink:href",
]);

function stripReplayCssUrls(value: string): string {
  return value
    .replace(/@import\s+(?:url\()?[^;)]+(?:\))?\s*;?/gi, "")
    .replace(/url\(\s*[^)]*\)/gi, "none");
}

function sanitizeReplayValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReplayValue(item));
  }
  if (!isRecord(value)) {
    if (typeof value !== "string") return value;
    const normalizedKey = key?.toLowerCase();
    if (
      normalizedKey === "href" ||
      REPLAY_NETWORK_ATTRIBUTES.has(normalizedKey ?? "")
    ) {
      return "about:blank";
    }
    if (
      normalizedKey === "style" ||
      normalizedKey === "_csstext" ||
      normalizedKey === "csstext"
    ) {
      return stripReplayCssUrls(value);
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeReplayValue(entryValue, entryKey),
    ]),
  );
}

/**
 * rrweb's iframe sandbox prevents scripts but permits passive resource loads.
 * Preserve the captured DOM structure and inline styling while neutralizing
 * URLs that could contact a recorded page or third-party origin.
 */
export function normalizeReplayEvents(events: unknown[]): AnyReplayEvent[] {
  return events
    .filter((event): event is AnyReplayEvent => isRecord(event))
    .map((event) => sanitizeReplayValue(event) as AnyReplayEvent)
    .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
}

export function buildReplayMarkers(events: AnyReplayEvent[]): ReplayMarker[] {
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
        label: "Navigate",
        detail: href,
        fields: [{ label: "URL", value: href }],
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Input
    ) {
      const inputValue = replayInputValue(event.data);
      markers.push({
        id: `input-${timestamp}-${markers.length}`,
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "input",
        label: inputValue ? "Input changed" : "Input",
        detail: inputValue,
        fields: markerFields([
          ["Element id", event.data?.id],
          ["Value", inputValue],
        ]),
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
        label: mouseInteractionLabel(event.data?.type),
        detail: pointerDetail(event.data),
        fields: markerFields([
          ["Element id", event.data?.id],
          ["X", event.data?.x],
          ["Y", event.data?.y],
        ]),
      });
    } else if (
      event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
      event.data?.source === INCREMENTAL_SOURCE.Scroll
    ) {
      markers.push({
        id: `scroll-${timestamp}-${markers.length}`,
        timestamp,
        offsetMs: Math.max(0, timestamp - startedAt),
        kind: "custom",
        label: "Scroll",
        detail: pointerDetail(event.data),
        fields: markerFields([
          ["Element id", event.data?.id],
          ["X", event.data?.x],
          ["Y", event.data?.y],
        ]),
      });
    } else if (event.type === RRWEB_EVENT_TYPE.Custom) {
      const marker = customReplayMarker(
        event,
        timestamp,
        startedAt,
        markers.length,
      );
      if (marker) markers.push(marker);
    }
  }
  return collapseScrollMarkerBursts(
    markers.sort((a, b) => a.offsetMs - b.offsetMs),
  );
}

function collapseScrollMarkerBursts(markers: ReplayMarker[]): ReplayMarker[] {
  const collapsed: ReplayMarker[] = [];
  const lastScrollByTarget = new Map<
    string,
    { index: number; timestamp: number }
  >();
  for (const marker of markers) {
    if (marker.label !== "Scroll") {
      collapsed.push(marker);
      continue;
    }
    const target =
      marker.fields?.find((field) => field.label === "Element id")?.value ??
      "viewport";
    const previous = lastScrollByTarget.get(target);
    if (
      previous &&
      marker.timestamp - previous.timestamp <= SCROLL_MARKER_BURST_MS
    ) {
      // Keep one marker per continuous scroll gesture, using its final
      // position while retaining the first marker's stable id/time.
      collapsed[previous.index] = {
        ...marker,
        id: collapsed[previous.index].id,
        timestamp: collapsed[previous.index].timestamp,
        offsetMs: collapsed[previous.index].offsetMs,
      };
      previous.timestamp = marker.timestamp;
      continue;
    }
    const index = collapsed.push(marker) - 1;
    lastScrollByTarget.set(target, { index, timestamp: marker.timestamp });
  }
  return collapsed;
}

export function replayDevToolsIssueCount(
  diagnostics: ReplayDevToolsDiagnostics,
  isComplete: boolean,
): number {
  if (!isComplete) return 0;
  return diagnostics.consoleErrorCount + diagnostics.networkFailedCount;
}

function customReplayMarker(
  event: AnyReplayEvent,
  timestamp: number,
  startedAt: number,
  index: number,
): ReplayMarker | null {
  const tag = String(event.data?.tag ?? "Custom event");
  const payload = isRecord(event.data?.payload) ? event.data.payload : {};
  const offsetMs = Math.max(0, timestamp - startedAt);

  if (tag === SESSION_REPLAY_CONSOLE_EVENT_TAG) {
    const level = typeof payload.level === "string" ? payload.level : "log";
    if (level !== "error" && level !== "warn") return null;
    const message =
      typeof payload.message === "string" ? payload.message : undefined;
    return {
      id: `console-${timestamp}-${index}`,
      timestamp,
      offsetMs,
      kind: "console",
      label: level === "error" ? "Console error" : `Console ${level}`,
      detail: message,
      severity:
        level === "error" ? "error" : level === "warn" ? "warn" : "info",
      fields: markerFields([
        ["Level", level],
        ["Source", payload.source],
        ["Message", message],
        ["URL", payload.url],
        ["Stack", payload.stack],
      ]),
    };
  }

  if (tag === SESSION_REPLAY_NETWORK_EVENT_TAG) {
    const status = Number(payload.status ?? 0);
    if (
      payload.ok !== false &&
      (!Number.isFinite(status) || !isFailedSessionReplayNetworkStatus(status))
    ) {
      return null;
    }
    const method =
      typeof payload.method === "string" ? payload.method : undefined;
    const url = typeof payload.url === "string" ? payload.url : undefined;
    const error = typeof payload.error === "string" ? payload.error : undefined;
    return {
      id: `network-${timestamp}-${index}`,
      timestamp,
      offsetMs,
      kind: "custom",
      label: "Network error", // i18n-ignore: timeline protocol label.
      detail: [method, url].filter(Boolean).join(" ") || error,
      severity: "error",
      fields: markerFields([
        ["Method", method],
        ["URL", url],
        ["Status", Number.isFinite(status) ? status : undefined],
        ["Error", error],
        ["Duration", payload.durationMs],
      ]),
    };
  }

  return {
    id: `custom-${timestamp}-${index}`,
    timestamp,
    offsetMs,
    kind: "custom",
    label: tag,
    detail: typeof payload.message === "string" ? payload.message : undefined,
  };
}

export function buildIdleSkipRanges(events: AnyReplayEvent[]): SkipRange[] {
  const startedAt = replayStartedAt(events);
  const interactions: number[] = [];
  let lastTimestamp = startedAt;
  for (const event of events) {
    const timestamp = Number(event.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    lastTimestamp = Math.max(lastTimestamp, timestamp);
    if (isReplayActivityEvent(event)) {
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

function isReplayActivityEvent(event: AnyReplayEvent): boolean {
  if (event.type === RRWEB_EVENT_TYPE.Meta) return true;
  if (event.type !== RRWEB_EVENT_TYPE.IncrementalSnapshot) return false;

  const source = event.data?.source;
  if (
    source === INCREMENTAL_SOURCE.Input ||
    source === INCREMENTAL_SOURCE.Scroll ||
    source === INCREMENTAL_SOURCE.TouchMove
  ) {
    return true;
  }
  if (source !== INCREMENTAL_SOURCE.MouseInteraction) return false;

  const interactionType = event.data?.type;
  return (
    interactionType === MOUSE_INTERACTION.MouseUp ||
    interactionType === MOUSE_INTERACTION.MouseDown ||
    interactionType === MOUSE_INTERACTION.Click ||
    interactionType === MOUSE_INTERACTION.ContextMenu ||
    interactionType === MOUSE_INTERACTION.DblClick ||
    interactionType === MOUSE_INTERACTION.Focus ||
    interactionType === MOUSE_INTERACTION.TouchStart ||
    interactionType === MOUSE_INTERACTION.TouchEnd
  );
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

function hasPlayableReplayEvents(events: unknown[]): boolean {
  let hasFullSnapshot = false;
  let hasMeta = false;
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (event.type === RRWEB_EVENT_TYPE.FullSnapshot) hasFullSnapshot = true;
    if (event.type === RRWEB_EVENT_TYPE.Meta) hasMeta = true;
    if (hasFullSnapshot && hasMeta) return true;
  }
  return false;
}

export function replayViewportDimensions(
  events: AnyReplayEvent[],
): ReplayViewportDimensions | null {
  // Latest Meta / ViewportResize for CSS fit-to-stage only. Never rewrite these
  // into the event stream — rrweb must keep Meta in sync with the FullSnapshot.
  let best: ReplayViewportDimensions | null = null;
  for (const event of events) {
    const dims = dimensionsFromReplayEvent(event);
    if (dims) best = dims;
  }
  return best;
}

function dimensionsFromReplayEvent(
  event: AnyReplayEvent,
): ReplayViewportDimensions | null {
  if (event.type === RRWEB_EVENT_TYPE.Meta) {
    return normalizeReplayDimensions(event.data?.width, event.data?.height);
  }
  if (
    event.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
    event.data?.source === INCREMENTAL_SOURCE.ViewportResize
  ) {
    return normalizeReplayDimensions(event.data?.width, event.data?.height);
  }
  return null;
}

/** Read raw positive finite dimensions; no aspect clamping. */
export function normalizeReplayDimensions(
  width: unknown,
  height: unknown,
): ReplayViewportDimensions | null {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function filterReplayMarkers(
  markers: ReplayMarker[],
  query: string,
): ReplayMarker[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return markers;
  return markers.filter((marker) => {
    const haystack = [
      marker.label,
      marker.detail,
      marker.kind,
      marker.severity,
      ...(marker.fields?.flatMap((field) => [field.label, field.value]) ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function replayStartedAt(events: AnyReplayEvent[]): number {
  let startedAt = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const timestamp = Number(event.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      startedAt = Math.min(startedAt, timestamp);
    }
  }
  return Number.isFinite(startedAt) ? startedAt : 0;
}

function replayDuration(events: AnyReplayEvent[]): number {
  const startedAt = replayStartedAt(events);
  let endedAt = startedAt;
  for (const event of events) {
    endedAt = Math.max(endedAt, Number(event.timestamp ?? 0));
  }
  return Math.max(0, endedAt - startedAt);
}

function replayInputValue(data: AnyRecord): string | undefined {
  if (typeof data.text === "string" && data.text) return data.text;
  if (typeof data.value === "string" && data.value) return data.value;
  if (typeof data.isChecked === "boolean") {
    return data.isChecked ? "Checked" : "Unchecked";
  }
  return undefined;
}

function mouseInteractionLabel(type: unknown): string {
  if (type === MOUSE_INTERACTION.DblClick) return "Double click";
  if (type === MOUSE_INTERACTION.Focus) return "Focus";
  return "Click";
}

function pointerDetail(data: AnyRecord): string | undefined {
  const x = Number(data.x);
  const y = Number(data.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return `x ${Math.round(x)}, y ${Math.round(y)}`;
  }
  return undefined;
}

function markerFields(
  entries: Array<[string, unknown]>,
): Array<{ label: string; value: string }> | undefined {
  const fields = entries.flatMap(([label, value]) => {
    if (value === undefined || value === null || value === "") return [];
    return [{ label, value: String(value) }];
  });
  return fields.length ? fields : undefined;
}

function visibleScrubberMarkers(
  markers: ReplayMarker[],
  totalTime: number,
): ReplayMarker[] {
  if (markers.length <= SCRUBBER_MARKER_LIMIT || totalTime <= 0) return markers;
  const bucketMs = Math.max(1, totalTime / SCRUBBER_MARKER_LIMIT);
  const buckets = new Map<number, ReplayMarker>();

  for (const marker of markers) {
    const bucket = Math.floor(marker.offsetMs / bucketMs);
    const current = buckets.get(bucket);
    if (!current || markerPriority(marker) > markerPriority(current)) {
      buckets.set(bucket, marker);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.offsetMs - b.offsetMs);
}

function markerPriority(marker: ReplayMarker): number {
  if (marker.severity === "error") return 6;
  if (marker.kind === "navigation") return 5;
  if (marker.kind === "click") return 4;
  if (marker.severity === "warn") return 3;
  if (marker.kind === "input") return 2;
  return 1;
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
