import { captureClientException } from "@agent-native/core/client/analytics";
import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  isLoomEmbedUrl,
  LOOM_START_MS_QUERY_PARAM,
  loomEmbedUrlWithTimestamp,
} from "@shared/loom";
import { IconBolt, IconPlayerPlay } from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { resolveMediaDurationMs } from "@/components/player/media-duration";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useMseVideoSource } from "@/hooks/use-mse-video-source";
import { usePlaybackPosition } from "@/hooks/use-playback-position";
import { setUrlSearchParam } from "@/lib/media-url";
import {
  parsePlaybackSpeed,
  readPlaybackSpeedPreference,
  savePlaybackSpeedPreference,
} from "@/lib/playback-speed";
import {
  captureVideoThumbnailBlob,
  thumbnailUrlHasVisibleContent,
  uploadRecordingThumbnail,
} from "@/lib/thumbnail-capture";
import {
  editedToOriginal,
  effectiveDuration,
  getExcludedRanges,
  isExcluded,
  originalToEdited,
  parseEdits,
  type TrimRange,
  lastKeptMs,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

import { CaptionsOverlay } from "./captions-overlay";
import { CtaButton } from "./cta-button";
import {
  PlaybackCommentOverlay,
  type PlaybackComment,
} from "./playback-comment-overlay";
import { PlayerControls, SPEED_OPTIONS } from "./player-controls";
import type {
  ReactionHandler,
  ReactionHandlerResult,
  ReactionSummary,
} from "./reactions-tray";
import { timelineMarkerMs } from "./scrubber-position";

function resolveLocalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) {
    const basePath = appBasePath();
    if (basePath && (url === basePath || url.startsWith(`${basePath}/`))) {
      return url;
    }
    return `${basePath}${url}`;
  }
  return url;
}

const VOLATILE_VIDEO_QUERY_PARAMS = new Set([
  "t",
  "cb",
  LOOM_START_MS_QUERY_PARAM,
  "password",
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Security-Token",
  "X-Amz-Signature",
  "X-Amz-SignedHeaders",
  "AWSAccessKeyId",
  "Expires",
  "Signature",
]);

const PLAY_ATTEMPT_TIMEOUT_MS = 15_000;

function videoSourceIdentity(url: string | undefined): string {
  if (!url) return "";
  try {
    const base =
      typeof window === "undefined"
        ? "http://clips.local"
        : window.location.href;
    const parsed = new URL(url, base);
    parsed.hash = "";
    for (const key of VOLATILE_VIDEO_QUERY_PARAMS) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function clampLoomSeek(ms: number, durationMs: number): number {
  const safeMs = Number.isFinite(ms) ? ms : 0;
  const upperBounded = durationMs > 0 ? Math.min(safeMs, durationMs) : safeMs;
  return Math.floor(Math.max(0, upperBounded));
}

function applyLoomStartToVideoSrc(src: string, ms: number): string {
  const directEmbedUrl = loomEmbedUrlWithTimestamp(src, ms);
  if (directEmbedUrl) return directEmbedUrl;
  return setUrlSearchParam(src, LOOM_START_MS_QUERY_PARAM, String(ms));
}

function isPlayerUiTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(target.closest("[data-player-ui]"))
  );
}

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

export interface VideoPlayerHandle {
  video: HTMLVideoElement | null;
  container: HTMLDivElement | null;
  play: () => Promise<void> | void;
  pause: () => void;
  seek: (ms: number) => void;
  getCurrentOriginalMs: () => number;
  setSpeed: (rate: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  toggleFullscreen: () => void;
  togglePip: () => Promise<void> | void;
}

export interface VideoPlayerProps {
  recordingId: string;
  videoUrl: string | null | undefined;
  mediaVersion?: string | number | null;
  videoFormat?: "webm" | "mp4" | null;
  embedProvider?: "loom" | null;
  durationMs: number;
  thumbnailUrl?: string | null;
  defaultSpeed?: number;
  autoPlay?: boolean;
  persistPlaybackPosition?: boolean;
  startMs?: number;
  editsJson?: string | null;
  comments?: PlaybackComment[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
  transcriptSegments?: { startMs: number; endMs: number; text: string }[];
  theaterMode?: boolean;
  onTheaterToggle?: () => void;
  cta?: {
    id: string;
    label: string;
    url: string;
    color: string;
    placement: "end" | "throughout";
  } | null;
  onCtaClick?: (ctaId: string) => void;
  onTimeUpdate?: (currentMs: number, totalMs: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (ms: number) => void;
  onSpeedChange?: (rate: number) => void;
  onEnded?: () => void;
  className?: string;
  alwaysShowControls?: boolean;
  hideChrome?: boolean;
  hideCaptions?: boolean;
  cover?: boolean;
  /**
   * Viewer role for this recording. When `owner`, we opportunistically capture
   * a visible frame for missing or blank auto-generated library thumbnails.
   */
  role?: "owner" | "admin" | "editor" | "commenter" | "viewer";
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
  onCommentClick?: () => void;
  enableReactions?: boolean;
  onReact?: ReactionHandler;
  enableComments?: boolean;
  onAddComment?: () => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(props, ref) {
    const t = useT();
    const {
      videoUrl,
      mediaVersion,
      videoFormat,
      embedProvider,
      durationMs,
      thumbnailUrl,
      defaultSpeed = 1.2,
      autoPlay,
      persistPlaybackPosition = true,
      startMs,
      editsJson,
      comments,
      chapters,
      reactions,
      transcriptSegments,
      theaterMode,
      onTheaterToggle,
      cta,
      onCtaClick,
      onTimeUpdate,
      onPlay,
      onPause,
      onSeek,
      onSpeedChange,
      onEnded,
      className,
      alwaysShowControls,
      hideChrome,
      hideCaptions,
      cover,
      recordingId,
      role,
      onVideoElementChange,
      onCommentClick,
      enableReactions,
      onReact,
      enableComments,
      onAddComment,
      onFullscreenChange,
    } = props;

    const resolvedVideoSrc = useMemo(() => {
      const localUrl = resolveLocalUrl(videoUrl);
      if (
        !localUrl ||
        mediaVersion == null ||
        embedProvider === "loom" ||
        isLoomEmbedUrl(localUrl)
      ) {
        return localUrl;
      }
      return setUrlSearchParam(localUrl, "media", String(mediaVersion));
    }, [embedProvider, mediaVersion, videoUrl]);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [playbackVideoEl, setPlaybackVideoEl] =
      useState<HTMLVideoElement | null>(null);
    const setVideoNode = useCallback(
      (el: HTMLVideoElement | null) => {
        videoRef.current = el;
        setPlaybackVideoEl(el);
        onVideoElementChange?.(el);
      },
      [onVideoElementChange],
    );
    const containerRef = useRef<HTMLDivElement | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchTapCandidateRef = useRef<{
      pointerId: number;
      x: number;
      y: number;
    } | null>(null);
    const suppressNextClickRef = useRef(false);
    const playAttemptPendingRef = useRef(false);
    const playAttemptIdRef = useRef(0);
    const autoPlayAttemptedSourceRef = useRef("");
    const playAttemptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const resumeAfterReloadMsRef = useRef<number | null>(null);
    const autoRetriedErrorRef = useRef(false);
    const recoveringFromErrorRef = useRef(false);
    const prevMseModeRef = useRef("");
    const currentMsRef = useRef(startMs ?? 0);
    const isPlayingRef = useRef(false);
    const [activeVideoSrc, setActiveVideoSrc] = useState(resolvedVideoSrc);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(startMs ?? 0);
    currentMsRef.current = currentMs;
    isPlayingRef.current = isPlaying;
    const [optimisticReactions, setOptimisticReactions] = useState<
      ReactionSummary[]
    >([]);
    const optimisticReactionIdRef = useRef(0);
    const [loomStartMs, setLoomStartMs] = useState<number | null>(null);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(() => !!autoPlay);
    const autoMutedRef = useRef(!!autoPlay);
    const lastAutoMutedRecordingIdRef = useRef(recordingId);
    const [speed, setSpeed] = useState(() =>
      readPlaybackSpeedPreference(defaultSpeed),
    );
    const [showControls, setShowControls] = useState(true);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
    const [markerLanes, setMarkerLanes] = useState<Map<number, number>>(
      new Map(),
    );
    const [isFullscreen, setIsFullscreen] = useState(false);
    const nativeFullscreenRef = useRef(false);
    const [isPip, setIsPip] = useState(false);
    const [, setCanPlay] = useState(false);
    const [isPlayPending, setIsPlayPending] = useState(() => !!autoPlay);
    const [isBuffering, setIsBuffering] = useState(false);
    const [playError, setPlayError] = useState<string | null>(null);
    const clearPlayAttemptWatchdog = useCallback(() => {
      if (playAttemptTimeoutRef.current === null) return;
      clearTimeout(playAttemptTimeoutRef.current);
      playAttemptTimeoutRef.current = null;
    }, []);
    const armPlayAttemptWatchdog = useCallback(
      (attemptId: number) => {
        clearPlayAttemptWatchdog();
        playAttemptTimeoutRef.current = setTimeout(() => {
          playAttemptTimeoutRef.current = null;
          if (
            attemptId !== playAttemptIdRef.current ||
            !playAttemptPendingRef.current
          ) {
            return;
          }

          playAttemptIdRef.current += 1;
          playAttemptPendingRef.current = false;
          videoRef.current?.pause();
          setIsPlaying(false);
          setIsPlayPending(false);
          setIsBuffering(false);
          setIsPreparing(false);
          const timeoutError = new Error(
            `Playback did not start within ${PLAY_ATTEMPT_TIMEOUT_MS}ms`,
          );
          reportPlaybackIssue(
            "play-start-timeout",
            timeoutError,
            videoRef.current,
            {
              recordingId,
              autoPlay: !!autoPlay,
            },
          );
          setPlayError("Playback is taking too long to start. Try again.");
        }, PLAY_ATTEMPT_TIMEOUT_MS);
      },
      [autoPlay, clearPlayAttemptWatchdog, recordingId],
    );
    const [resolvedDurationMs, setResolvedDurationMs] = useState<number>(
      Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    );
    const durationProbedRef = useRef(false);
    const initialVisibleFrameSeekedRef = useRef(false);
    const loomInitialStartAppliedRef = useRef("");
    const thumbnailCapturedRef = useRef(false);
    const [thumbnailLoadFailed, setThumbnailLoadFailed] = useState(false);
    const [, setIsPreparing] = useState<boolean>(!!videoUrl);
    const edits = useMemo(() => parseEdits(editsJson), [editsJson]);
    const hasEditorThumbnail = Boolean(edits.thumbnail);
    const [shouldRefreshAutoThumbnail, setShouldRefreshAutoThumbnail] =
      useState(false);
    const excludedRanges = useMemo(() => getExcludedRanges(edits), [edits]);
    const scrubberTimeline = useMemo(() => {
      const mapMarker = (originalMs: number): number | null => {
        if (!Number.isFinite(originalMs) || isExcluded(originalMs, edits)) {
          return null;
        }
        return originalToEdited(originalMs, edits);
      };

      return {
        durationMs: effectiveDuration(resolvedDurationMs, edits),
        currentMs: originalToEdited(currentMs, edits),
        comments: (comments ?? []).flatMap((comment) => {
          const editedMs = mapMarker(comment.videoTimestampMs);
          return editedMs === null
            ? []
            : [
                {
                  id: comment.id,
                  content: comment.content,
                  authorEmail: comment.authorEmail,
                  authorName: comment.authorName,
                  videoTimestampMs: editedMs,
                },
              ];
        }),
        chapters: (chapters ?? []).flatMap((chapter) => {
          const editedMs = mapMarker(chapter.startMs);
          return editedMs === null
            ? []
            : [{ startMs: editedMs, title: chapter.title }];
        }),
        reactions: [
          ...(reactions ?? []).flatMap((reaction) => {
            const editedMs = mapMarker(reaction.videoTimestampMs);
            return editedMs === null
              ? []
              : [
                  {
                    id: reaction.id,
                    emoji: reaction.emoji,
                    videoTimestampMs: editedMs,
                  },
                ];
          }),
          ...optimisticReactions.flatMap((reaction) => {
            const editedMs = mapMarker(reaction.videoTimestampMs);
            return editedMs === null
              ? []
              : [
                  {
                    id: reaction.id,
                    emoji: reaction.emoji,
                    videoTimestampMs: editedMs,
                  },
                ];
          }),
        ],
      };
    }, [
      chapters,
      comments,
      currentMs,
      edits,
      optimisticReactions,
      reactions,
      resolvedDurationMs,
    ]);

    useEffect(() => {
      if (!optimisticReactions.length || !reactions?.length) return;
      setOptimisticReactions((current) => {
        const next = current.filter(
          (optimistic) =>
            !reactions.some(
              (persisted) =>
                persisted.emoji === optimistic.emoji &&
                Math.abs(
                  persisted.videoTimestampMs - optimistic.videoTimestampMs,
                ) < 1000,
            ),
        );
        return next.length === current.length ? current : next;
      });
    }, [optimisticReactions.length, reactions]);

    const handleReact = useCallback<ReactionHandler>(
      (emoji) => {
        const optimistic = {
          id: `optimistic-reaction-${++optimisticReactionIdRef.current}`,
          emoji,
          videoTimestampMs: currentMsRef.current,
        };
        setOptimisticReactions((current) => [...current, optimistic]);

        const removeOptimistic = () => {
          setOptimisticReactions((current) =>
            current.filter((reaction) => reaction.id !== optimistic.id),
          );
        };

        let result: ReactionHandlerResult | undefined;
        try {
          result = onReact?.(emoji);
        } catch {
          removeOptimistic();
          return false;
        }

        if (result && typeof result === "object" && "then" in result) {
          return Promise.resolve(result).then(
            (saved) => {
              if (saved === false) removeOptimistic();
              return saved !== false;
            },
            () => {
              removeOptimistic();
              return false;
            },
          );
        }

        if (result === false) removeOptimistic();
        return result !== false;
      },
      [onReact],
    );
    const activeVideoSourceIdentity = useMemo(
      () => videoSourceIdentity(activeVideoSrc),
      [activeVideoSrc],
    );
    const isLoomEmbed = useMemo(
      () => embedProvider === "loom" || isLoomEmbedUrl(activeVideoSrc),
      [activeVideoSrc, embedProvider],
    );
    const restorePlaybackPosition = useCallback(
      (positionMs: number) => {
        const v = videoRef.current;
        if (!v || (startMs && startMs > 0)) return;
        if (hasPlaybackStarted && !autoPlay) return;
        if (!autoPlay && isPlayPending) return;
        if (!autoPlay && v.currentTime > 0.5) return;

        const visibleMs = clampSeek(
          skipExcludedRange(positionMs, excludedRanges, resolvedDurationMs),
          v,
          resolvedDurationMs,
        );
        if (visibleMs <= 0) return;

        try {
          initialVisibleFrameSeekedRef.current = true;
          v.currentTime = visibleMs / 1000;
          setCurrentMs(visibleMs);
          setCanPlay(true);
          setIsPreparing(false);
          onTimeUpdate?.(visibleMs, resolvedDurationMs);
        } catch (error) {
          console.warn("[clips] playback position restore failed", error);
        }
      },
      [
        autoPlay,
        excludedRanges,
        hasPlaybackStarted,
        isPlayPending,
        onTimeUpdate,
        resolvedDurationMs,
        startMs,
      ],
    );
    usePlaybackPosition({
      recordingId,
      videoEl: playbackVideoEl,
      durationMs,
      enabled: persistPlaybackPosition,
      explicitStartMs: startMs,
      allowRestoreWhilePlaying: autoPlay,
      onRestore: restorePlaybackPosition,
    });
    const unsupportedFormat = useMemo(() => {
      if (isLoomEmbed || !activeVideoSrc) return false;
      if (typeof document === "undefined") return false;
      const mime = videoFormat === "mp4" ? "video/mp4" : "video/webm";
      try {
        const probe = document.createElement("video");
        return probe.canPlayType(mime) === "";
      } catch {
        return false;
      }
    }, [activeVideoSrc, isLoomEmbed, videoFormat]);
    const loomIframeSrc = useMemo(() => {
      if (!isLoomEmbed || !activeVideoSrc || loomStartMs === null) {
        return activeVideoSrc;
      }
      return applyLoomStartToVideoSrc(activeVideoSrc, loomStartMs);
    }, [activeVideoSrc, isLoomEmbed, loomStartMs]);
    const incomingVideoSourceIdentity = useMemo(
      () => videoSourceIdentity(resolvedVideoSrc),
      [resolvedVideoSrc],
    );

    const mse = useMseVideoSource({
      videoRef,
      sourceUrl: resolvedVideoSrc,
      durationMs,
      videoFormat,
      disabled: isLoomEmbed || unsupportedFormat,
    });
    const mseActive = mse.mode === "mse" && Boolean(mse.objectUrl);
    const domVideoSrc = mseActive
      ? mse.objectUrl
      : mse.mode === "pending"
        ? undefined
        : activeVideoSrc;

    useEffect(() => {
      const prev = prevMseModeRef.current;
      prevMseModeRef.current = mse.mode;
      if (prev !== "mse" || mse.mode !== "native") return;

      const wasPlaying = isPlayingRef.current;
      const posMs = currentMsRef.current > 0 ? currentMsRef.current : null;
      if (posMs != null) resumeAfterReloadMsRef.current = posMs;

      if (activeVideoSrc) {
        recoveringFromErrorRef.current = true;
        setActiveVideoSrc(
          setUrlSearchParam(activeVideoSrc, "cb", String(Date.now())),
        );
      }

      if (wasPlaying) {
        const nextId = playAttemptIdRef.current + 1;
        playAttemptIdRef.current = nextId;
        playAttemptPendingRef.current = true;
        setIsPlayPending(true);
        setIsBuffering(true);
        armPlayAttemptWatchdog(nextId);
      } else {
        clearPlayAttemptWatchdog();
        setIsPlaying(false);
        setIsBuffering(false);
      }
      setIsPreparing(true);
      setCanPlay(false);
    }, [
      activeVideoSrc,
      armPlayAttemptWatchdog,
      clearPlayAttemptWatchdog,
      mse.mode,
    ]);

    useEffect(() => {
      if (!resolvedVideoSrc) {
        setActiveVideoSrc(undefined);
        return;
      }
      if (!activeVideoSrc) {
        setActiveVideoSrc(resolvedVideoSrc);
        return;
      }

      const v = videoRef.current;
      const sameResource =
        activeVideoSourceIdentity === incomingVideoSourceIdentity;
      if (recoveringFromErrorRef.current && sameResource) return;

      const playbackActive =
        playAttemptPendingRef.current ||
        isPlayPending ||
        isPlaying ||
        Boolean(v && !v.paused && !v.ended);

      if (!sameResource || !playbackActive) {
        setActiveVideoSrc(resolvedVideoSrc);
      }
    }, [
      activeVideoSourceIdentity,
      activeVideoSrc,
      incomingVideoSourceIdentity,
      isPlayPending,
      isPlaying,
      resolvedVideoSrc,
    ]);

    useEffect(() => {
      setHasPlaybackStarted(false);
    }, [activeVideoSourceIdentity]);

    useEffect(() => {
      if (!isLoomEmbed) return;
      clearPlayAttemptWatchdog();
      playAttemptPendingRef.current = false;
      setCanPlay(true);
      setIsPreparing(false);
      setIsBuffering(false);
      setIsPlayPending(false);
      setPlayError(null);
    }, [activeVideoSourceIdentity, clearPlayAttemptWatchdog, isLoomEmbed]);

    const bumpControls = useCallback(() => {
      setShowControls(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (alwaysShowControls) return;
      idleTimer.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    }, [alwaysShowControls]);

    const resolvePlayAttempt = useCallback(
      (attemptId: number) => {
        if (attemptId !== playAttemptIdRef.current) return;
        clearPlayAttemptWatchdog();
        playAttemptPendingRef.current = false;
        const v = videoRef.current;
        if (v && !v.paused && !v.ended) {
          setIsPlaying(true);
          setHasPlaybackStarted(true);
        }
        setCanPlay(true);
        setIsPlayPending(false);
        setIsBuffering(false);
        setIsPreparing(false);
      },
      [clearPlayAttemptWatchdog],
    );

    const rejectPlayAttempt = useCallback(
      (attemptId: number, err: unknown) => {
        if (attemptId !== playAttemptIdRef.current) return;
        clearPlayAttemptWatchdog();
        playAttemptPendingRef.current = false;
        setIsPlayPending(false);
        setIsBuffering(false);

        const name = err instanceof DOMException ? err.name : "";
        if (name === "AbortError" || name === "NotAllowedError") return;

        console.warn("[clips] playback start failed", err);
        reportPlaybackIssue("play-start-failed", err, videoRef.current, {
          recordingId,
          autoPlay: !!autoPlay,
        });
        setPlayError("Could not start playback. Try again.");
      },
      [autoPlay, clearPlayAttemptWatchdog, recordingId],
    );

    const attachPlayPromise = useCallback(
      (playPromise: Promise<void> | undefined, attemptId: number) => {
        if (!playPromise || typeof playPromise.then !== "function") {
          resolvePlayAttempt(attemptId);
          return;
        }

        void playPromise
          .then(() => resolvePlayAttempt(attemptId))
          .catch((err) => rejectPlayAttempt(attemptId, err));
      },
      [rejectPlayAttempt, resolvePlayAttempt],
    );

    const requestPlay = useCallback(() => {
      const v = videoRef.current;
      if (!v || !activeVideoSrc) return;
      if (playAttemptPendingRef.current) return;

      bumpControls();
      setPlayError(null);

      if (v.ended) {
        try {
          v.currentTime = 0;
          setCurrentMs(0);
        } catch {
          // Let the normal play attempt report a media error if the seek fails.
        }
      }

      if (
        !hasPlaybackStarted &&
        (!startMs || startMs <= 0) &&
        ((initialVisibleFrameSeekedRef.current && v.currentTime > 0.05) ||
          v.currentTime > 1e7)
      ) {
        try {
          const initialPlaybackMs = skipExcludedRange(
            0,
            excludedRanges,
            resolvedDurationMs,
          );
          v.currentTime = initialPlaybackMs / 1000;
          setCurrentMs(initialPlaybackMs);
        } catch {
          // If the browser refuses the rewind, continue with the normal play
          // attempt; playback is still better than blocking on a cosmetic seek.
        }
      }

      if (v.error) {
        resumeAfterReloadMsRef.current = currentMs > 0 ? currentMs : null;
        setCanPlay(false);
        setIsPreparing(true);
        setIsBuffering(false);
        v.load();
      } else if (v.readyState >= 2 || v.currentTime > 0) {
        setCanPlay(true);
        setIsPreparing(false);
      }
      setIsBuffering(v.readyState < 3);
      setIsPlayPending(true);

      const attemptId = playAttemptIdRef.current + 1;
      playAttemptIdRef.current = attemptId;
      playAttemptPendingRef.current = true;
      armPlayAttemptWatchdog(attemptId);

      try {
        attachPlayPromise(v.play(), attemptId);
      } catch (err) {
        rejectPlayAttempt(attemptId, err);
      }
    }, [
      activeVideoSrc,
      armPlayAttemptWatchdog,
      attachPlayPromise,
      bumpControls,
      currentMs,
      excludedRanges,
      hasPlaybackStarted,
      rejectPlayAttempt,
      resolvedDurationMs,
      startMs,
    ]);

    const retryPendingPlay = useCallback(
      (v: HTMLVideoElement) => {
        if (!playAttemptPendingRef.current || !v.paused) return;
        try {
          attachPlayPromise(v.play(), playAttemptIdRef.current);
        } catch (err) {
          rejectPlayAttempt(playAttemptIdRef.current, err);
        }
      },
      [attachPlayPromise, rejectPlayAttempt],
    );

    const pauseVideo = useCallback(() => {
      playAttemptIdRef.current += 1;
      playAttemptPendingRef.current = false;
      clearPlayAttemptWatchdog();
      setIsPlayPending(false);
      setIsBuffering(false);
      videoRef.current?.pause();
    }, [clearPlayAttemptWatchdog]);

    const clearAutoMuted = useCallback(() => {
      autoMutedRef.current = false;
    }, []);

    const unmuteAutoplayFallback = useCallback(() => {
      const v = videoRef.current;
      if (!v || !autoMutedRef.current || !v.muted) return false;
      v.muted = false;
      setMuted(false);
      autoMutedRef.current = false;
      return true;
    }, []);

    const togglePlayback = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.ended) {
        try {
          v.currentTime = 0;
          setCurrentMs(0);
        } catch {
          // Let the normal play attempt report a media error if the seek fails.
        }
        unmuteAutoplayFallback();
        requestPlay();
        return;
      }
      if (!v.paused || isPlaying) {
        pauseVideo();
        return;
      }
      unmuteAutoplayFallback();
      requestPlay();
    }, [isPlaying, pauseVideo, requestPlay, unmuteAutoplayFallback]);

    const activateVideoSurface = useCallback(
      (input: "mouse" | "touch") => {
        const v = videoRef.current;
        if (v && !v.paused && !v.ended && unmuteAutoplayFallback()) {
          bumpControls();
          return;
        }

        if (input === "touch" && !hideChrome) {
          togglePlayback();
          bumpControls();
          return;
        }

        togglePlayback();
        bumpControls();
      },
      [bumpControls, hideChrome, togglePlayback, unmuteAutoplayFallback],
    );

    const handlePlayerPointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (
          e.pointerType === "mouse" ||
          e.button !== 0 ||
          isLoomEmbed ||
          isPlayerUiTarget(e.target)
        ) {
          return;
        }

        touchTapCandidateRef.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
        };
      },
      [isLoomEmbed],
    );

    const handlePlayerPointerUp = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        const candidate = touchTapCandidateRef.current;
        if (!candidate || candidate.pointerId !== e.pointerId) return;
        touchTapCandidateRef.current = null;

        if (isLoomEmbed || isPlayerUiTarget(e.target)) return;

        const moved = Math.max(
          Math.abs(e.clientX - candidate.x),
          Math.abs(e.clientY - candidate.y),
        );
        if (moved > 12) return;

        e.preventDefault();
        suppressNextClickRef.current = true;
        activateVideoSurface("touch");
      },
      [activateVideoSurface, isLoomEmbed],
    );

    const handlePlayerPointerCancel = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (touchTapCandidateRef.current?.pointerId === e.pointerId) {
          touchTapCandidateRef.current = null;
        }
      },
      [],
    );

    const applySpeed = useCallback(
      (rate: number) => {
        const nextSpeed = parsePlaybackSpeed(rate) ?? defaultSpeed;
        const v = videoRef.current;

        if (v) {
          v.defaultPlaybackRate = nextSpeed;
          v.playbackRate = nextSpeed;
        }
        setSpeed(nextSpeed);
        savePlaybackSpeedPreference(nextSpeed);
        onSpeedChange?.(nextSpeed);
      },
      [defaultSpeed, onSpeedChange],
    );

    const seekToVisibleMs = useCallback(
      (ms: number) => {
        if (isLoomEmbed) {
          if (!activeVideoSrc) return;
          const clamped = clampLoomSeek(ms, resolvedDurationMs);
          const visibleMs = clampLoomSeek(
            skipExcludedRange(clamped, excludedRanges, resolvedDurationMs),
            resolvedDurationMs,
          );
          setLoomStartMs(visibleMs);
          setCurrentMs(visibleMs);
          if (visibleMs > 0) setHasPlaybackStarted(true);
          setIsPreparing(false);
          onSeek?.(visibleMs);
          onTimeUpdate?.(visibleMs, resolvedDurationMs);
          return;
        }

        const v = videoRef.current;
        if (!v) return;
        const requested =
          lastKept > 0 && lastKept < resolvedDurationMs // i18n-ignore — a comparison, not copy
            ? Math.min(ms, lastKept - 1)
            : ms;
        const clamped = clampSeek(requested, v, resolvedDurationMs);
        const visibleMs = clampSeek(
          skipExcludedRange(clamped, excludedRanges, resolvedDurationMs),
          v,
          resolvedDurationMs,
        );
        v.currentTime = visibleMs / 1000;
        setCurrentMs(visibleMs);
        if (visibleMs > 0) setHasPlaybackStarted(true);
        onSeek?.(visibleMs);
        onTimeUpdate?.(visibleMs, resolvedDurationMs);
      },
      [
        activeVideoSrc,
        excludedRanges,
        isLoomEmbed,
        onSeek,
        onTimeUpdate,
        resolvedDurationMs,
      ],
    );

    const seekByMs = useCallback(
      (deltaMs: number) => {
        const v = videoRef.current;
        const liveOriginalMs =
          v &&
          Number.isFinite(v.currentTime) &&
          v.currentTime >= 0 &&
          v.currentTime < 1e7
            ? Math.floor(v.currentTime * 1000)
            : currentMs;
        const liveEditedMs = originalToEdited(liveOriginalMs, edits);
        seekToVisibleMs(editedToOriginal(liveEditedMs + deltaMs, edits));
      },
      [currentMs, edits, seekToVisibleMs],
    );

    useImperativeHandle(
      ref,
      () => ({
        get video() {
          return videoRef.current;
        },
        get container() {
          return containerRef.current;
        },
        play: requestPlay,
        pause: pauseVideo,
        seek: seekToVisibleMs,
        getCurrentOriginalMs: () => {
          const v = videoRef.current;
          const liveOriginalMs =
            v &&
            Number.isFinite(v.currentTime) &&
            v.currentTime >= 0 &&
            v.currentTime < 1e7
              ? Math.floor(v.currentTime * 1000)
              : currentMsRef.current;
          return liveOriginalMs;
        },
        setSpeed: applySpeed,
        toggleMute: () => {
          if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setMuted(videoRef.current.muted);
            autoMutedRef.current = false;
          }
        },
        toggleCaptions: () => setCaptionsOn((v) => !v),
        toggleFullscreen: () => void toggleFullscreenInternal(),
        togglePip: () => togglePipInternal(),
      }),
      [applySpeed, pauseVideo, requestPlay, seekToVisibleMs],
    );

    useEffect(() => {
      onFullscreenChange?.(isFullscreen);
    }, [isFullscreen, onFullscreenChange]);

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const initialSpeed = readPlaybackSpeedPreference(defaultSpeed);
      v.defaultPlaybackRate = initialSpeed;
      v.playbackRate = initialSpeed;
      setSpeed(initialSpeed);
      onSpeedChange?.(initialSpeed);
      if (startMs && startMs > 0) {
        const visibleMs = clampSeek(
          skipExcludedRange(startMs, excludedRanges, resolvedDurationMs),
          v,
          resolvedDurationMs,
        );
        v.currentTime = visibleMs / 1000;
        setCurrentMs(visibleMs);
        if (visibleMs > 0) setHasPlaybackStarted(true);
      }
    }, [
      activeVideoSrc,
      defaultSpeed,
      excludedRanges,
      onSpeedChange,
      resolvedDurationMs,
      startMs,
    ]);

    useEffect(() => {
      if (!isLoomEmbed || !activeVideoSrc || !startMs || startMs <= 0) return;
      const applyKey = `${activeVideoSourceIdentity}:${startMs}`;
      if (loomInitialStartAppliedRef.current === applyKey) return;
      loomInitialStartAppliedRef.current = applyKey;

      const clamped = clampLoomSeek(startMs, resolvedDurationMs);
      const visibleMs = clampLoomSeek(
        skipExcludedRange(clamped, excludedRanges, resolvedDurationMs),
        resolvedDurationMs,
      );
      setLoomStartMs(visibleMs);
      setCurrentMs(visibleMs);
      if (visibleMs > 0) setHasPlaybackStarted(true);
      onTimeUpdate?.(visibleMs, resolvedDurationMs);
    }, [
      activeVideoSourceIdentity,
      activeVideoSrc,
      excludedRanges,
      isLoomEmbed,
      onTimeUpdate,
      resolvedDurationMs,
      startMs,
    ]);

    useEffect(() => {
      if (Number.isFinite(durationMs) && durationMs > 0) {
        setResolvedDurationMs(durationMs);
      }
      durationProbedRef.current = false;
    }, [activeVideoSrc, durationMs]);

    const probeDurationIfNeeded = useCallback(
      (v: HTMLVideoElement) => {
        if (durationProbedRef.current) return;
        if (Number.isFinite(v.duration) && v.duration > 0) {
          durationProbedRef.current = true;
          setResolvedDurationMs(resolveMediaDurationMs(durationMs, v.duration));
          return;
        }
        if (playAttemptPendingRef.current || !v.paused) return;

        durationProbedRef.current = true;
        try {
          v.currentTime = 1e10;
        } catch {
          // Safari occasionally throws — the durationchange fallback still
          // picks up the real duration.
        }
      },
      [durationMs],
    );

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;

      const onLoadedMetadata = () => probeDurationIfNeeded(v);

      const onDurationChange = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          setResolvedDurationMs(resolveMediaDurationMs(durationMs, v.duration));
          if (durationProbedRef.current && v.currentTime > v.duration) {
            try {
              v.currentTime = 0;
              setCurrentMs(0);
            } catch {
              // ignore
            }
          }
        }
      };

      v.addEventListener("loadedmetadata", onLoadedMetadata);
      v.addEventListener("durationchange", onDurationChange);
      if (v.readyState >= 1) probeDurationIfNeeded(v);

      return () => {
        v.removeEventListener("loadedmetadata", onLoadedMetadata);
        v.removeEventListener("durationchange", onDurationChange);
      };
    }, [activeVideoSrc, durationMs, probeDurationIfNeeded]);

    useEffect(() => {
      thumbnailCapturedRef.current = false;
      initialVisibleFrameSeekedRef.current = false;
      loomInitialStartAppliedRef.current = "";
      autoRetriedErrorRef.current = false;
      recoveringFromErrorRef.current = false;
      setLoomStartMs(null);
      playAttemptIdRef.current += 1;
      playAttemptPendingRef.current = false;
      autoPlayAttemptedSourceRef.current = "";
      if (lastAutoMutedRecordingIdRef.current !== recordingId) {
        lastAutoMutedRecordingIdRef.current = recordingId;
        autoMutedRef.current = !!autoPlay;
      }
      clearPlayAttemptWatchdog();
      setCanPlay(false);
      setIsPlayPending(!!autoPlay);
      setIsBuffering(false);
      setPlayError(null);
    }, [
      activeVideoSourceIdentity,
      autoPlay,
      clearPlayAttemptWatchdog,
      recordingId,
    ]);

    useEffect(() => {
      if (!autoPlay || !domVideoSrc || !activeVideoSrc || isLoomEmbed) return;
      if (autoPlayAttemptedSourceRef.current === activeVideoSrc) return;

      const v = videoRef.current;
      if (!v) return;

      autoPlayAttemptedSourceRef.current = activeVideoSrc;
      if (!v.paused && !v.ended) return;

      requestPlay();
    }, [activeVideoSrc, autoPlay, domVideoSrc, isLoomEmbed, requestPlay]);

    useEffect(() => {
      setThumbnailLoadFailed(false);
    }, [recordingId, thumbnailUrl]);

    useEffect(() => {
      let cancelled = false;
      setShouldRefreshAutoThumbnail(false);

      if (!thumbnailUrl || hasEditorThumbnail) return;

      void thumbnailUrlHasVisibleContent(thumbnailUrl).then((visible) => {
        if (!cancelled && visible === false) {
          setShouldRefreshAutoThumbnail(true);
          thumbnailCapturedRef.current = false;
        }
      });

      return () => {
        cancelled = true;
      };
    }, [hasEditorThumbnail, thumbnailUrl]);

    // thumbnails, but refresh auto-generated thumbnails that probed as blank.
    const captureThumbnail = useCallback(() => {
      if (thumbnailCapturedRef.current) return;
      if (role !== "owner") return;
      if (hasEditorThumbnail) return;
      if (!recordingId) return;
      const replaceAuto = Boolean(thumbnailUrl && shouldRefreshAutoThumbnail);
      if (thumbnailUrl && !replaceAuto) return;
      const v = videoRef.current;
      if (!v || !v.videoWidth || !v.videoHeight) return;

      thumbnailCapturedRef.current = true;

      void captureVideoThumbnailBlob(v)
        .then((blob) => {
          if (!blob) {
            thumbnailCapturedRef.current = false;
            return null;
          }
          return uploadRecordingThumbnail(recordingId, blob, { replaceAuto });
        })
        .catch((err) => {
          console.warn("[clips] thumbnail capture/upload failed", err);
          try {
            captureClientException(err, {
              tags: { uploadStep: "thumbnail" },
              extra: {
                recordingId,
                replaceAuto,
                message: err instanceof Error ? err.message : String(err),
              },
            });
          } catch {
            // Best-effort — never throw from a fire-and-forget catch.
          }
        });
    }, [
      hasEditorThumbnail,
      recordingId,
      role,
      shouldRefreshAutoThumbnail,
      thumbnailUrl,
    ]);

    const seekInitialVisibleFrame = useCallback(
      (v: HTMLVideoElement): boolean => {
        if (initialVisibleFrameSeekedRef.current) return false;
        if (autoPlay) return false;
        if (startMs && startMs > 0) return false;
        if (hasPlaybackStarted) return false;
        if (playAttemptPendingRef.current || !v.paused) return false;
        if (!Number.isFinite(v.duration) || v.duration < 0.8) return false;
        if (v.currentTime > 0.05) return false;
        const targetMs = Math.min(350, Math.max(120, v.duration * 100));
        const visibleMs = clampSeek(
          skipExcludedRange(targetMs, excludedRanges, resolvedDurationMs),
          v,
          resolvedDurationMs,
        );
        if (visibleMs <= 0) return false;
        initialVisibleFrameSeekedRef.current = true;
        try {
          v.currentTime = visibleMs / 1000;
          return true;
        } catch {
          return false;
        }
      },
      [
        autoPlay,
        excludedRanges,
        hasPlaybackStarted,
        resolvedDurationMs,
        startMs,
      ],
    );

    useEffect(() => {
      if (!activeVideoSrc) {
        setIsPreparing(false);
        return;
      }
      const v = videoRef.current;
      if (v && (v.readyState >= 2 || v.currentTime > 0)) {
        setIsPreparing(false);
        return;
      }
      setIsPreparing(true);
      const t = setTimeout(() => {
        setIsPreparing(false);
        setCanPlay(true);
      }, 10000);
      return () => clearTimeout(t);
    }, [activeVideoSrc]);

    useEffect(() => {
      bumpControls();
      return () => {
        if (idleTimer.current) clearTimeout(idleTimer.current);
      };
    }, [bumpControls]);

    useEffect(
      () => () => {
        clearPlayAttemptWatchdog();
      },
      [clearPlayAttemptWatchdog],
    );

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const onEnter = () => setIsPip(true);
      const onLeave = () => setIsPip(false);
      v.addEventListener("enterpictureinpicture", onEnter);
      v.addEventListener("leavepictureinpicture", onLeave);
      return () => {
        v.removeEventListener("enterpictureinpicture", onEnter);
        v.removeEventListener("leavepictureinpicture", onLeave);
        if (document.pictureInPictureElement === v) {
          v.pause();
          void document
            .exitPictureInPicture()
            .catch((error) =>
              console.warn("[clips] PiP cleanup failed", error),
            );
        }
      };
    }, [activeVideoSrc]);

    async function togglePipInternal() {
      const v = videoRef.current;
      if (!v) return;
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (typeof (v as any).requestPictureInPicture === "function") {
          await (v as any).requestPictureInPicture();
        }
      } catch (err) {
        console.warn("[clips] PiP failed", err);
      }
    }

    async function toggleFullscreenInternal() {
      const el = containerRef.current;
      const video = videoRef.current as WebkitFullscreenVideo | null;
      if (!el) return;
      const hasNativeVideoFullscreen =
        typeof video?.webkitEnterFullscreen === "function";
      let nativeFullscreenAttempted = false;
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          setIsFullscreen(false);
          return;
        }

        if (nativeFullscreenRef.current || video?.webkitDisplayingFullscreen) {
          video?.webkitExitFullscreen?.();
          nativeFullscreenRef.current = false;
          setIsFullscreen(false);
          return;
        }

        const documentFullscreenUnavailable = !document.fullscreenEnabled;
        if (
          hasNativeVideoFullscreen &&
          (documentFullscreenUnavailable ||
            typeof el.requestFullscreen !== "function")
        ) {
          nativeFullscreenAttempted = true;
          video.webkitEnterFullscreen?.();
          nativeFullscreenRef.current = true;
          setIsFullscreen(true);
          return;
        }

        if (isFullscreen) {
          setIsFullscreen(false);
          return;
        }

        if (typeof el.requestFullscreen === "function") {
          await el.requestFullscreen();
          if (document.fullscreenElement || !hasNativeVideoFullscreen) {
            setIsFullscreen(true);
            return;
          }

          nativeFullscreenAttempted = true;
          video.webkitEnterFullscreen?.();
          nativeFullscreenRef.current = true;
          setIsFullscreen(true);
          return;
        }

        if (hasNativeVideoFullscreen) {
          nativeFullscreenAttempted = true;
          video.webkitEnterFullscreen?.();
          nativeFullscreenRef.current = true;
          setIsFullscreen(true);
          return;
        }

        setIsFullscreen(true);
      } catch (err) {
        if (
          !nativeFullscreenAttempted &&
          hasNativeVideoFullscreen &&
          !document.fullscreenElement
        ) {
          try {
            nativeFullscreenAttempted = true;
            video.webkitEnterFullscreen?.();
            nativeFullscreenRef.current = true;
            setIsFullscreen(true);
            return;
          } catch (fallbackErr) {
            console.warn("[clips] Fullscreen fallback failed", fallbackErr);
          }
        }
        console.warn("[clips] Fullscreen failed", err);
        setIsFullscreen(true);
      }
    }

    useEffect(() => {
      const video = videoRef.current as WebkitFullscreenVideo | null;
      const onFs = () => setIsFullscreen(!!document.fullscreenElement);
      const onNativeFsEnter = () => {
        nativeFullscreenRef.current = true;
        setIsFullscreen(true);
      };
      const onNativeFsExit = () => {
        nativeFullscreenRef.current = false;
        setIsFullscreen(false);
      };
      document.addEventListener("fullscreenchange", onFs);
      video?.addEventListener("webkitbeginfullscreen", onNativeFsEnter);
      video?.addEventListener("webkitendfullscreen", onNativeFsExit);
      return () => {
        document.removeEventListener("fullscreenchange", onFs);
        video?.removeEventListener("webkitbeginfullscreen", onNativeFsEnter);
        video?.removeEventListener("webkitendfullscreen", onNativeFsExit);
      };
    }, [playbackVideoEl]);

    const currentSegment = transcriptSegments?.find(
      (s) => currentMs >= s.startMs && currentMs <= s.endMs,
    );

    const showEndCta =
      cta &&
      cta.placement === "end" &&
      resolvedDurationMs > 0 &&
      currentMs >= resolvedDurationMs - 200;

    const fullscreenMenuContainer = isFullscreen ? containerRef.current : null;

    const showThroughoutCta = cta && cta.placement === "throughout";
    const controlsVisible =
      showControls || !isPlaying || isPlayPending || isBuffering;
    const centerOverlayMode =
      activeVideoSrc &&
      !isLoomEmbed &&
      !unsupportedFormat &&
      !showEndCta &&
      (!isPlaying || isPlayPending || isBuffering)
        ? isPlayPending || isBuffering
          ? "loading"
          : "ready"
        : null;
    const centerOverlayLabel =
      isPlayPending && !hasPlaybackStarted && !autoPlay
        ? "Starting playback"
        : isPlayPending || isBuffering
          ? "Buffering"
          : "Preparing clip";

    const lastKept = useMemo(
      () => lastKeptMs(resolvedDurationMs, excludedRanges),
      [excludedRanges, resolvedDurationMs],
    );

    return (
      <div
        ref={containerRef}
        className={cn(
          "relative @container bg-black overflow-hidden select-none group",
          theaterMode || isFullscreen
            ? "fixed inset-0 z-40 h-dvh w-dvw"
            : "rounded-xl",
          className,
        )}
        onMouseMove={bumpControls}
        onMouseLeave={() => !alwaysShowControls && setShowControls(false)}
        onPointerDown={handlePlayerPointerDown}
        onPointerUp={handlePlayerPointerUp}
        onPointerCancel={handlePlayerPointerCancel}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (isPlayerUiTarget(e.target)) return;
          if (isLoomEmbed) return;
          activateVideoSurface("mouse");
        }}
      >
        {isLoomEmbed && loomIframeSrc ? (
          <iframe
            src={loomIframeSrc}
            title={t("videoPlayer.loomVideo")}
            className="h-full w-full border-0"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : unsupportedFormat ? (
          <div className="relative flex h-full w-full items-center justify-center bg-black">
            {thumbnailUrl && !thumbnailLoadFailed ? (
              <img
                src={resolveLocalUrl(thumbnailUrl)}
                alt=""
                onError={() => setThumbnailLoadFailed(true)}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  cover ? "object-cover" : "object-contain",
                )}
              />
            ) : null}
            <div className="relative z-10 mx-4 max-w-xs rounded-md bg-black/70 px-4 py-3 text-center text-sm font-medium text-white/85 ring-1 ring-white/10">
              {t("videoPlayer.unsupportedFormat")}
            </div>
          </div>
        ) : activeVideoSrc ? (
          <video
            ref={setVideoNode}
            src={domVideoSrc}
            poster={resolveLocalUrl(thumbnailUrl)}
            className={cn(
              "w-full h-full",
              cover ? "object-cover" : "object-contain",
            )}
            autoPlay={autoPlay}
            muted={muted}
            playsInline
            onLoadStart={() => {
              setCanPlay(false);
              setIsPreparing(true);
              setIsBuffering(false);
              setPlayError(null);
            }}
            onPlay={() => {
              setIsPlaying(true);
              setHasPlaybackStarted(true);
              setCanPlay(true);
              setIsPreparing(false);
              setIsBuffering(false);
              onPlay?.();
            }}
            onPlaying={() => {
              setIsPlaying(true);
              setHasPlaybackStarted(true);
              setCanPlay(true);
              setIsPreparing(false);
              setIsBuffering(false);
              resolvePlayAttempt(playAttemptIdRef.current);
            }}
            onPause={() => {
              setIsPlaying(false);
              if (playAttemptPendingRef.current) {
                setIsBuffering(true);
                return;
              }
              setIsPlayPending(false);
              setIsBuffering(false);
              if (videoRef.current) probeDurationIfNeeded(videoRef.current);
              onPause?.();
            }}
            onLoadedData={(e) => {
              recoveringFromErrorRef.current = false;
              const resumeMs = resumeAfterReloadMsRef.current;
              if (resumeMs != null) {
                resumeAfterReloadMsRef.current = null;
                try {
                  e.currentTarget.currentTime = resumeMs / 1000;
                  setCurrentMs(resumeMs);
                } catch {
                  // Ignore — worst case playback resumes from 0.
                }
              }
              const didSeek = seekInitialVisibleFrame(e.currentTarget);
              setCanPlay(e.currentTarget.readyState >= 2);
              setIsPreparing(false);
              retryPendingPlay(e.currentTarget);
              if (!didSeek) captureThumbnail();
            }}
            onCanPlay={(e) => {
              const didSeek = seekInitialVisibleFrame(e.currentTarget);
              setCanPlay(true);
              setIsPreparing(false);
              setIsBuffering(false);
              retryPendingPlay(e.currentTarget);
              if (!didSeek) captureThumbnail();
            }}
            onCanPlayThrough={(e) => {
              setCanPlay(true);
              setIsPreparing(false);
              setIsBuffering(false);
              retryPendingPlay(e.currentTarget);
            }}
            onWaiting={(e) => {
              if (!e.currentTarget.paused || playAttemptPendingRef.current) {
                setIsBuffering(true);
              }
            }}
            onStalled={(e) => {
              if (!e.currentTarget.paused || playAttemptPendingRef.current) {
                setIsBuffering(true);
              }
            }}
            onSeeked={() => {
              setCanPlay(true);
              setIsPreparing(false);
              setIsBuffering(false);
              captureThumbnail();
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              const raw = v.currentTime;
              const ct =
                Number.isFinite(raw) && raw >= 0 && raw < 1e7 ? raw : 0;
              const ms = Math.floor(ct * 1000);
              if (
                initialVisibleFrameSeekedRef.current &&
                !hasPlaybackStarted &&
                !playAttemptPendingRef.current &&
                v.paused &&
                (!startMs || startMs <= 0)
              ) {
                setCurrentMs(0);
                onTimeUpdate?.(0, resolvedDurationMs);
                return;
              }
              if (
                lastKept > 0 && // i18n-ignore — a comparison, not copy
                lastKept < resolvedDurationMs &&
                ms >= lastKept
              ) {
                try {
                  v.pause();
                  v.currentTime = Math.max(0, lastKept / 1000 - 0.05);
                } catch (err) {
                  console.warn(
                    "[player] could not stop at the last kept frame",
                    {
                      err: err instanceof Error ? err.message : String(err),
                    },
                  );
                }
                setCurrentMs(lastKept);
                setIsPlaying(false);
                setIsBuffering(false);
                onTimeUpdate?.(lastKept, resolvedDurationMs);
                onEnded?.();
                return;
              }
              const visibleMs = clampSeek(
                skipExcludedRange(ms, excludedRanges, resolvedDurationMs),
                v,
                resolvedDurationMs,
              );
              if (visibleMs > ms) {
                v.currentTime = visibleMs / 1000;
                setCurrentMs(visibleMs);
                if (visibleMs > 0) {
                  setCanPlay(true);
                  setHasPlaybackStarted(true);
                  setIsPreparing(false);
                  setIsBuffering(false);
                }
                onTimeUpdate?.(visibleMs, resolvedDurationMs);
                return;
              }
              setCurrentMs(ms);
              if (ms > 0) {
                setCanPlay(true);
                setHasPlaybackStarted(true);
                setIsPreparing(false);
                setIsBuffering(false);
              }
              onTimeUpdate?.(ms, resolvedDurationMs);
            }}
            onEnded={() => {
              clearPlayAttemptWatchdog();
              playAttemptPendingRef.current = false;
              const v = videoRef.current;
              const restOnKeptFrame =
                lastKept > 0 && lastKept < resolvedDurationMs; // i18n-ignore — a comparison, not copy
              if (v && restOnKeptFrame) {
                try {
                  v.currentTime = Math.max(0, lastKept / 1000 - 0.05);
                } catch (err) {
                  console.warn(
                    "[player] could not rest on the last kept frame",
                    {
                      err: err instanceof Error ? err.message : String(err),
                    },
                  );
                }
              }
              const endedMs =
                resolvedDurationMs > 0
                  ? resolvedDurationMs
                  : videoRef.current &&
                      Number.isFinite(videoRef.current.duration) &&
                      videoRef.current.duration > 0
                    ? Math.round(videoRef.current.duration * 1000)
                    : currentMs;
              setCurrentMs(endedMs);
              setIsPlaying(false);
              setIsPlayPending(false);
              setIsBuffering(false);
              setIsPreparing(false);
              onTimeUpdate?.(endedMs, resolvedDurationMs);
              onEnded?.();
            }}
            onError={(e) => {
              clearPlayAttemptWatchdog();
              playAttemptPendingRef.current = false;
              setIsPlayPending(false);

              if (mseActive) {
                mse.fallbackToNative();
                setIsBuffering(false);
                setIsPreparing(true);
                setCanPlay(false);
                return;
              }

              if (!autoRetriedErrorRef.current && activeVideoSrc) {
                autoRetriedErrorRef.current = true;
                recoveringFromErrorRef.current = true;
                const v = e.currentTarget;
                const cacheBustedSrc = setUrlSearchParam(
                  activeVideoSrc,
                  "cb",
                  String(Date.now()),
                );
                resumeAfterReloadMsRef.current =
                  currentMs > 0 ? currentMs : null;
                setIsBuffering(false);
                setIsPreparing(true);
                setCanPlay(false);
                v.src = cacheBustedSrc;
                v.load();
                setActiveVideoSrc(cacheBustedSrc);
                return;
              }

              recoveringFromErrorRef.current = false;
              setIsBuffering(false);
              setIsPreparing(false);
              const desc = describeMediaError(e.currentTarget.error);
              reportPlaybackIssue(
                "media-load-failed",
                e.currentTarget.error,
                e.currentTarget,
                {
                  recordingId,
                  videoSrc: activeVideoSrc,
                  autoRetried: autoRetriedErrorRef.current,
                },
              );
              setPlayError(
                desc
                  ? `Video could not be loaded (${desc.label}).`
                  : "Video could not be loaded.",
              );
            }}
            onVolumeChange={(e) => {
              setVolume(e.currentTarget.volume);
              setMuted(e.currentTarget.muted);
            }}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
            {t("videoPlayer.noVideo")}
          </div>
        )}

        {thumbnailUrl &&
        !thumbnailLoadFailed &&
        !autoPlay &&
        !hasPlaybackStarted &&
        (!startMs || startMs <= 0) ? (
          <img
            src={resolveLocalUrl(thumbnailUrl)}
            alt=""
            aria-hidden="true"
            onError={() => setThumbnailLoadFailed(true)}
            className={cn(
              "pointer-events-none absolute inset-0 h-full w-full",
              cover ? "object-cover" : "object-contain",
            )}
          />
        ) : null}

        {centerOverlayMode ? (
          <CenterPlaybackOverlay
            mode={centerOverlayMode}
            label={centerOverlayLabel}
            durationMs={scrubberTimeline.durationMs}
            speed={speed}
            playError={playError}
            onPlay={() => {
              const v = videoRef.current;
              if (v && v.muted) {
                v.muted = false;
                setMuted(false);
              }
              clearAutoMuted();
              requestPlay();
            }}
            onSpeedChange={applySpeed}
            menuPortalContainer={fullscreenMenuContainer}
          />
        ) : null}

        {playError && centerOverlayMode ? (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center">
            <p
              role="status"
              className="max-w-xs rounded-md bg-background px-3 py-2 text-center text-xs font-medium text-foreground ring-1 ring-border"
            >
              {playError}
            </p>
          </div>
        ) : null}

        {/* Captions */}
        {!hideCaptions &&
        !isLoomEmbed &&
        captionsOn &&
        hasPlaybackStarted &&
        currentSegment ? (
          <CaptionsOverlay text={currentSegment.text} />
        ) : null}

        {/* Timestamped comments */}
        {!hideChrome && !isLoomEmbed && hasPlaybackStarted && !showEndCta ? (
          <PlaybackCommentOverlay
            comments={comments}
            currentMs={currentMs}
            playbackRate={speed}
            durationMs={scrubberTimeline.durationMs}
            getTimelinePositionMs={(comment) =>
              isExcluded(comment.videoTimestampMs, edits)
                ? null
                : originalToEdited(comment.videoTimestampMs, edits)
            }
            getTimelineLane={(comment) => {
              const editedMs = isExcluded(comment.videoTimestampMs, edits)
                ? null
                : originalToEdited(comment.videoTimestampMs, edits);
              if (editedMs === null) return null;
              return markerLanes.get(timelineMarkerMs(editedMs)) ?? 0;
            }}
            onClick={onCommentClick}
          />
        ) : null}

        {/* Floating CTA (throughout placement) */}
        {showThroughoutCta ? (
          <div data-player-ui className="absolute bottom-16 right-4 z-50">
            <CtaButton
              cta={cta!}
              onClick={() => onCtaClick?.(cta!.id)}
              floating
            />
          </div>
        ) : null}

        {/* End-card CTA */}
        {showEndCta ? (
          <div
            data-player-ui
            data-player-end-cta
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            style={{ zIndex: 60 }}
          >
            <div className="flex flex-col items-center gap-4 text-white">
              <p className="text-lg font-medium">{t("videoPlayer.thanks")}</p>
              <CtaButton
                cta={cta!}
                onClick={() => onCtaClick?.(cta!.id)}
                large
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-player-ui
                aria-label={t("videoPlayer.playClip")}
                onClick={(e) => {
                  e.stopPropagation();
                  const v = videoRef.current;
                  if (!v) return;
                  try {
                    v.currentTime = 0;
                    setCurrentMs(0);
                  } catch {
                    // The regular play path will surface any media error.
                  }
                  requestPlay();
                }}
                className="border-player-control-foreground/30 bg-player-control-foreground/10 text-player-control-foreground hover:bg-player-control-foreground/20 hover:text-player-control-foreground focus-visible:ring-player-control-foreground pointer-events-auto h-8 px-2.5 text-xs"
              >
                <IconPlayerPlay className="fill-current" />
                {t("videoPlayer.playClip")}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Controls */}
        {!hideChrome && !isLoomEmbed ? (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 opacity-100 transition-opacity duration-200",
              controlsVisible ? "" : "sm:opacity-0 sm:pointer-events-none",
            )}
          >
            <PlayerControls
              isPlaying={isPlaying}
              durationMs={scrubberTimeline.durationMs}
              currentMs={scrubberTimeline.currentMs}
              volume={volume}
              muted={muted}
              speed={speed}
              captionsOn={captionsOn}
              isFullscreen={isFullscreen}
              isPip={isPip}
              theaterMode={!!theaterMode}
              comments={scrubberTimeline.comments}
              chapters={scrubberTimeline.chapters}
              reactions={scrubberTimeline.reactions}
              onMarkerLanesChange={setMarkerLanes}
              hasCaptions={!!transcriptSegments?.length}
              onPlayPause={() => {
                togglePlayback();
              }}
              onSeek={(editedMs) => {
                seekToVisibleMs(editedToOriginal(editedMs, edits));
              }}
              onSeekRelative={seekByMs}
              onVolumeChange={(vol) => {
                const v = videoRef.current;
                if (v) {
                  v.volume = vol;
                  v.muted = vol === 0;
                  setVolume(vol);
                  setMuted(vol === 0);
                  clearAutoMuted();
                }
              }}
              onToggleMute={() => {
                const v = videoRef.current;
                if (v) {
                  v.muted = !v.muted;
                  setMuted(v.muted);
                  clearAutoMuted();
                }
              }}
              onSpeedChange={(rate) => {
                applySpeed(rate);
              }}
              onToggleCaptions={() => setCaptionsOn((v) => !v)}
              onTogglePip={() => void togglePipInternal()}
              onToggleFullscreen={() => void toggleFullscreenInternal()}
              onToggleTheater={onTheaterToggle}
              menuPortalContainer={fullscreenMenuContainer}
              showReactionsAndComment={isFullscreen}
              enableReactions={enableReactions}
              onReact={handleReact}
              enableComments={enableComments}
              onAddComment={onAddComment}
            />
          </div>
        ) : null}
      </div>
    );
  },
);

function CenterPlaybackOverlay({
  mode,
  label,
  durationMs,
  speed,
  playError,
  onPlay,
  onSpeedChange,
  menuPortalContainer,
}: {
  mode: "loading" | "ready";
  label: string;
  durationMs: number;
  speed: number;
  playError: string | null;
  onPlay: () => void;
  onSpeedChange: (rate: number) => void;
  menuPortalContainer?: HTMLElement | null;
}) {
  const t = useT();
  const showLoading = mode === "loading" && !playError;
  const adjustedDurationMs = speed > 0 ? durationMs / speed : durationMs;
  const showAdjustedDuration =
    durationMs > 0 && Math.abs(adjustedDurationMs - durationMs) >= 1000;

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center pointer-events-none text-white transition-colors",
        showLoading ? "bg-black/55" : "bg-black/15",
      )}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 px-4 drop-shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
        {showLoading ? (
          <div className="flex flex-col items-center gap-3 rounded-md bg-black/70 px-4 py-3 shadow-xl ring-1 ring-white/10 backdrop-blur-md">
            <Spinner className="h-8 w-8 text-white/85" />
            <p className="text-sm font-medium text-white/85">{label}</p>
          </div>
        ) : (
          <>
            <Button
              data-player-ui
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t("videoPlayer.playClip")}
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              className="bg-player-control-foreground text-player-control ring-player-control-foreground/35 hover:bg-player-control-foreground hover:text-player-control focus-visible:ring-player-control-foreground focus-visible:ring-offset-player-control pointer-events-auto size-[clamp(2.75rem,8cqw,4rem)] rounded-full shadow-xl ring-1 hover:scale-105 [&_svg]:size-[clamp(1.25rem,3.5cqw,1.75rem)]"
            >
              <IconPlayerPlay className="fill-current" />
            </Button>

            <div
              data-player-ui
              className="bg-player-control/75 text-player-control-foreground ring-player-control-foreground/10 pointer-events-auto flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold shadow-lg ring-1 backdrop-blur-md"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground focus-visible:ring-player-control-foreground/70 h-6 rounded px-1.5 text-xs tabular-nums"
                  >
                    {formatSpeedLabel(speed)}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="center"
                  side="top"
                  className="min-w-[96px]"
                  container={menuPortalContainer}
                >
                  <DropdownMenuLabel>Speed</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {SPEED_OPTIONS.map((rate) => (
                    <DropdownMenuItem
                      key={rate}
                      onSelect={() => onSpeedChange(rate)}
                      className={cn(
                        "tabular-nums",
                        rate === speed && "bg-accent font-semibold",
                      )}
                    >
                      {formatSpeedLabel(rate)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="h-4 w-px bg-white/20" aria-hidden />
              <span className="flex min-w-12 items-center justify-center gap-1.5 whitespace-nowrap text-center tabular-nums">
                {showAdjustedDuration ? (
                  <>
                    <span className="text-white/45 line-through decoration-white/55">
                      {formatWatchDuration(durationMs)}
                    </span>
                    <IconBolt className="h-3.5 w-3.5 fill-current text-yellow-300" />
                    <span>{formatWatchDuration(adjustedDurationMs)}</span>
                  </>
                ) : (
                  formatWatchDuration(durationMs)
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function clampSeek(
  ms: number,
  v: HTMLVideoElement,
  resolvedDurationMs: number,
): number {
  let maxMs = Number.POSITIVE_INFINITY;
  if (resolvedDurationMs > 0) {
    maxMs = resolvedDurationMs;
  } else if (Number.isFinite(v.duration) && v.duration > 0) {
    maxMs = v.duration * 1000;
  } else if (v.seekable && v.seekable.length > 0) {
    maxMs = v.seekable.end(v.seekable.length - 1) * 1000;
  }
  return Math.floor(Math.max(0, Math.min(maxMs, ms)));
}

function skipExcludedRange(
  ms: number,
  excludedRanges: TrimRange[],
  durationMs: number,
): number {
  const range = excludedRanges.find((r) => ms >= r.startMs && ms < r.endMs);
  if (!range) return ms;
  const next = Math.max(ms, range.endMs);
  return durationMs > 0 ? Math.min(next, durationMs) : next;
}

function formatSpeedLabel(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}x`;
}

function describeMediaError(
  err: MediaError | null,
): { code: number; label: string } | null {
  if (!err) return null;
  const labels: Record<number, string> = {
    1: "load aborted",
    2: "network error",
    3: "decode error",
    4: "format not supported",
  };
  return { code: err.code, label: labels[err.code] ?? "unknown error" };
}

function reportPlaybackIssue(
  reason: string,
  err: unknown,
  video: HTMLVideoElement | null,
  extra: Record<string, unknown>,
) {
  const mediaError =
    err && typeof err === "object" && "code" in err
      ? (err as MediaError)
      : (video?.error ?? null);
  const name =
    err instanceof DOMException || err instanceof Error ? err.name : undefined;
  const message = err instanceof Error ? err.message : undefined;

  let videoHost: string | undefined;
  try {
    if (video?.currentSrc) videoHost = new URL(video.currentSrc).host;
  } catch {
    // ignore unparseable src
  }
  let inIframe = false;
  try {
    inIframe = typeof window !== "undefined" && window.self !== window.top;
  } catch {
    inIframe = true;
  }

  const detail = {
    ...extra,
    errorName: name,
    errorMessage: message,
    mediaErrorCode: mediaError?.code,
    mediaErrorLabel: describeMediaError(mediaError)?.label,
    videoHost,
    inIframe,
    readyState: video?.readyState,
    networkState: video?.networkState,
  };
  console.warn(`[clips] playback issue: ${reason}`, detail);

  try {
    const reportable =
      err instanceof Error
        ? err
        : new Error(
            `clips playback ${reason}: ${message ?? name ?? describeMediaError(mediaError)?.label ?? "unknown"}`,
          );
    captureClientException(reportable, {
      tags: {
        area: "clips-player",
        playbackIssue: reason,
        inIframe: String(inIframe),
      },
      extra: detail,
    });
  } catch {
    // Diagnostics must never break playback UI.
  }
}

function formatWatchDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 sec";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }

  return `${seconds} sec`;
}
