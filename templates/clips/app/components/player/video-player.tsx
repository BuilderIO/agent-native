import {
  appBasePath,
  captureClientException,
  useT,
} from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
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
  getExcludedRanges,
  parseEdits,
  type TrimRange,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";

import { CaptionsOverlay } from "./captions-overlay";
import { CtaButton } from "./cta-button";
import { PlayerControls, SPEED_OPTIONS } from "./player-controls";

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

function setUrlSearchParam(url: string, key: string, value: string): string {
  try {
    const base =
      typeof window === "undefined"
        ? "http://clips.local"
        : window.location.href;
    const parsed = new URL(url, base);
    parsed.searchParams.set(key, value);
    if (url.startsWith("/") && !url.startsWith("//")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
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

export interface VideoPlayerHandle {
  video: HTMLVideoElement | null;
  play: () => Promise<void> | void;
  pause: () => void;
  seek: (ms: number) => void;
  setSpeed: (rate: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  toggleFullscreen: () => void;
  togglePip: () => Promise<void> | void;
}

export interface VideoPlayerProps {
  recordingId: string;
  videoUrl: string | null | undefined;
  embedProvider?: "loom" | null;
  durationMs: number;
  thumbnailUrl?: string | null;
  /** Default playback rate. Clips default is 1.2x. */
  defaultSpeed?: number;
  /** Autoplay on mount. */
  autoPlay?: boolean;
  /** Start time in ms. */
  startMs?: number;
  /** Comment + chapter overlays for the scrubber. */
  editsJson?: string | null;
  comments?: { id: string; videoTimestampMs: number; content: string }[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
  transcriptSegments?: { startMs: number; endMs: number; text: string }[];
  /** Theatre-mode wraps the whole viewport. */
  theaterMode?: boolean;
  onTheaterToggle?: () => void;
  /** Whether to show the built-in CTA button. */
  cta?: {
    id: string;
    label: string;
    url: string;
    color: string;
    placement: "end" | "throughout";
  } | null;
  onCtaClick?: (ctaId: string) => void;
  /** Emit events as the video plays (for analytics). */
  onTimeUpdate?: (currentMs: number, totalMs: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (ms: number) => void;
  onSpeedChange?: (rate: number) => void;
  onEnded?: () => void;
  className?: string;
  /** When true the controls never hide (useful for embed with showControls). */
  alwaysShowControls?: boolean;
  /** Hide all chrome (for embed). */
  hideChrome?: boolean;
  /** Disable captions UI. */
  hideCaptions?: boolean;
  /** Optional poster/thumbnail styling. */
  cover?: boolean;
  /**
   * Viewer role for this recording. When `owner`, we opportunistically capture
   * a visible frame for missing or blank auto-generated library thumbnails.
   */
  role?: "owner" | "admin" | "editor" | "viewer";
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(props, ref) {
    const t = useT();
    const {
      videoUrl,
      embedProvider,
      durationMs,
      thumbnailUrl,
      defaultSpeed = 1.2,
      autoPlay,
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
    } = props;

    const resolvedVideoSrc = useMemo(
      () => resolveLocalUrl(videoUrl),
      [videoUrl],
    );
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const playAttemptPendingRef = useRef(false);
    const playAttemptIdRef = useRef(0);
    const [activeVideoSrc, setActiveVideoSrc] = useState(resolvedVideoSrc);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(startMs ?? 0);
    const [loomStartMs, setLoomStartMs] = useState<number | null>(null);
    const [volume, setVolume] = useState(1);
    // Autoplaying players (e.g. the Slack unfurl embed, `?autoplay=1`) must
    // start muted or the browser blocks autoplay with a NotAllowedError. The
    // share page (no autoplay) keeps full sound.
    const [muted, setMuted] = useState(() => !!autoPlay);
    const [speed, setSpeed] = useState(() =>
      readPlaybackSpeedPreference(defaultSpeed),
    );
    const [showControls, setShowControls] = useState(true);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPip, setIsPip] = useState(false);
    const [canPlay, setCanPlay] = useState(false);
    const [isPlayPending, setIsPlayPending] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [playError, setPlayError] = useState<string | null>(null);
    // MediaRecorder-created WebM files report `video.duration === Infinity`
    // until the browser has actually scrubbed to the end. When that happens
    // the scrubber's percentage math breaks (anything / Infinity = 0) and
    // Chrome refuses to honor `currentTime = X` seeks. We therefore track the
    // duration ourselves, starting from the durationMs prop (which comes from
    // the recorder's elapsed-time counter and is always a real number) and
    // upgrading it once `loadedmetadata` tells us the real value.
    const [resolvedDurationMs, setResolvedDurationMs] = useState<number>(
      Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    );
    // Whether we've already applied the Infinity-duration work-around so we
    // don't seek to 1e10 on every loadedmetadata fire (autoplay + iOS replay).
    const durationProbedRef = useRef(false);
    const initialVisibleFrameSeekedRef = useRef(false);
    const loomInitialStartAppliedRef = useRef("");
    // Whether we've already captured-and-uploaded a still-frame thumbnail for
    // this clip. Owner-only and once per player lifecycle.
    const thumbnailCapturedRef = useRef(false);
    // "Preparing your clip…" overlay — shown while the browser buffers the
    // first frame of a freshly-finalized clip so the user doesn't see a blank
    // black rectangle. Hidden on loadeddata / canplay / currentTime > 0, or
    // after a 10s safety timeout.
    const [isPreparing, setIsPreparing] = useState<boolean>(!!videoUrl);
    const edits = useMemo(() => parseEdits(editsJson), [editsJson]);
    const hasEditorThumbnail = Boolean(edits.thumbnail);
    const [shouldRefreshAutoThumbnail, setShouldRefreshAutoThumbnail] =
      useState(false);
    const excludedRanges = useMemo(() => getExcludedRanges(edits), [edits]);
    const activeVideoSourceIdentity = useMemo(
      () => videoSourceIdentity(activeVideoSrc),
      [activeVideoSrc],
    );
    const isLoomEmbed = useMemo(
      () => embedProvider === "loom" || isLoomEmbedUrl(activeVideoSrc),
      [activeVideoSrc, embedProvider],
    );
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
      setCanPlay(true);
      setIsPreparing(false);
      setIsBuffering(false);
      setIsPlayPending(false);
      setPlayError(null);
    }, [activeVideoSourceIdentity, isLoomEmbed]);

    // Hide controls after 2s of idle movement.
    const bumpControls = useCallback(() => {
      setShowControls(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (alwaysShowControls) return;
      idleTimer.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    }, [alwaysShowControls]);

    const resolvePlayAttempt = useCallback((attemptId: number) => {
      if (attemptId !== playAttemptIdRef.current) return;
      playAttemptPendingRef.current = false;
      setIsPlayPending(false);
      setIsBuffering(false);
      setIsPreparing(false);
    }, []);

    const rejectPlayAttempt = useCallback(
      (attemptId: number, err: unknown) => {
        if (attemptId !== playAttemptIdRef.current) return;
        playAttemptPendingRef.current = false;
        setIsPlayPending(false);
        setIsBuffering(false);

        const name = err instanceof DOMException ? err.name : "";
        // AbortError: a newer load/seek superseded this play() — not a failure.
        // NotAllowedError: the browser blocked autoplay because there was no
        // user gesture (this is what happens inside Slack's cross-origin unfurl
        // iframe). Both are expected — fall back to the click-to-play overlay
        // instead of showing a scary "Could not start playback" message.
        if (name === "AbortError" || name === "NotAllowedError") return;

        console.warn("[clips] playback start failed", err);
        reportPlaybackIssue("play-start-failed", err, videoRef.current, {
          recordingId,
          autoPlay: !!autoPlay,
        });
        setPlayError("Could not start playback. Try again.");
      },
      [autoPlay, recordingId],
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
      setIsBuffering(v.readyState < 3);
      setIsPlayPending(true);

      const attemptId = playAttemptIdRef.current + 1;
      playAttemptIdRef.current = attemptId;
      playAttemptPendingRef.current = true;

      try {
        attachPlayPromise(v.play(), attemptId);
      } catch (err) {
        rejectPlayAttempt(attemptId, err);
      }
    }, [activeVideoSrc, attachPlayPromise, bumpControls, rejectPlayAttempt]);

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
      setIsPlayPending(false);
      setIsBuffering(false);
      videoRef.current?.pause();
    }, []);

    const togglePlayback = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (!v.paused || isPlaying) {
        pauseVideo();
        return;
      }
      requestPlay();
    }, [isPlaying, pauseVideo, requestPlay]);

    const applySpeed = useCallback(
      (rate: number) => {
        const nextSpeed = parsePlaybackSpeed(rate) ?? defaultSpeed;
        const v = videoRef.current;
        const shouldKeepPlaying = Boolean(
          v &&
          !v.ended &&
          (isPlaying || playAttemptPendingRef.current || !v.paused),
        );

        if (v) v.playbackRate = nextSpeed;
        setSpeed(nextSpeed);
        savePlaybackSpeedPreference(nextSpeed);
        onSpeedChange?.(nextSpeed);

        if (shouldKeepPlaying && typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            const current = videoRef.current;
            if (current && current.paused && !current.ended) requestPlay();
          });
        }
      },
      [defaultSpeed, isPlaying, onSpeedChange, requestPlay],
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
        const clamped = clampSeek(ms, v, resolvedDurationMs);
        const visibleMs = clampSeek(
          skipExcludedRange(clamped, excludedRanges, resolvedDurationMs),
          v,
          resolvedDurationMs,
        );
        v.currentTime = visibleMs / 1000;
        setCurrentMs(visibleMs);
        onSeek?.(visibleMs);
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

    // Imperative handle for parent
    useImperativeHandle(
      ref,
      () => ({
        get video() {
          return videoRef.current;
        },
        play: requestPlay,
        pause: pauseVideo,
        seek: seekToVisibleMs,
        setSpeed: applySpeed,
        toggleMute: () => {
          if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setMuted(videoRef.current.muted);
          }
        },
        toggleCaptions: () => setCaptionsOn((v) => !v),
        toggleFullscreen: () => void toggleFullscreenInternal(),
        togglePip: () => togglePipInternal(),
      }),
      [applySpeed, pauseVideo, requestPlay, seekToVisibleMs],
    );

    // Apply initial playbackRate and start position.
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const initialSpeed = readPlaybackSpeedPreference(defaultSpeed);
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

    // Keep the resolved duration in sync with the prop when it changes (new
    // recording loaded, etc.) — only bump it if the prop is a real number.
    useEffect(() => {
      if (Number.isFinite(durationMs) && durationMs > 0) {
        setResolvedDurationMs(durationMs);
      }
      durationProbedRef.current = false;
    }, [activeVideoSrc, durationMs]);

    // The recorder's elapsed-time counter (durationMs prop) is the most
    // trustworthy length we have. A MediaRecorder WebM's own duration is
    // cluster-estimated and lands short by up to one timeslice, so we never
    // let it overwrite a real prop — doing so makes the scrubber jump to a
    // shorter length than the actual recording on first watch.
    const hasReliableDurationProp =
      Number.isFinite(durationMs) && durationMs > 0;

    const probeDurationIfNeeded = useCallback(
      (v: HTMLVideoElement) => {
        if (durationProbedRef.current) return;
        if (Number.isFinite(v.duration) && v.duration > 0) {
          durationProbedRef.current = true;
          if (!hasReliableDurationProp) {
            setResolvedDurationMs(Math.round(v.duration * 1000));
          }
          return;
        }
        if (playAttemptPendingRef.current || !v.paused) return;

        // Poke the browser into computing the real duration for MediaRecorder
        // WebM files. Defer this while playback is starting; the large seek can
        // otherwise abort the first user-initiated play().
        durationProbedRef.current = true;
        try {
          v.currentTime = 1e10;
        } catch {
          // Safari occasionally throws — the durationchange fallback still
          // picks up the real duration.
        }
      },
      [hasReliableDurationProp],
    );

    // Resolve the WebM-duration-is-Infinity Chrome quirk: when a video created
    // by MediaRecorder doesn't have a Duration element in the container, the
    // <video> element reports `duration === Infinity` until we scrub to the
    // very end. Once we do, `durationchange` fires with the real duration.
    // Without this, scrubber clicks/drags silently no-op (Chrome ignores
    // `currentTime = X` when duration is Infinity) and the percent fill stays
    // at 0 because `currentMs / Infinity = 0`.
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;

      const onLoadedMetadata = () => probeDurationIfNeeded(v);

      const onDurationChange = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          // Don't downgrade a trustworthy recorder duration to the
          // cluster-estimated WebM duration; only adopt it as a fallback.
          if (!hasReliableDurationProp) {
            setResolvedDurationMs(Math.round(v.duration * 1000));
          }
          // After we've resolved the real duration, rewind back to 0 so the
          // user isn't sitting at the end of the clip.
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
      // If metadata is already loaded by the time this effect runs, trigger it.
      if (v.readyState >= 1) probeDurationIfNeeded(v);

      return () => {
        v.removeEventListener("loadedmetadata", onLoadedMetadata);
        v.removeEventListener("durationchange", onDurationChange);
      };
    }, [activeVideoSrc, hasReliableDurationProp, probeDurationIfNeeded]);

    // Reset the thumbnail-capture flag when the source changes (e.g. the
    // player is reused for a different recording via React Router).
    useEffect(() => {
      thumbnailCapturedRef.current = false;
      initialVisibleFrameSeekedRef.current = false;
      loomInitialStartAppliedRef.current = "";
      setLoomStartMs(null);
      playAttemptIdRef.current += 1;
      playAttemptPendingRef.current = false;
      setCanPlay(false);
      setIsPlayPending(false);
      setIsBuffering(false);
      setPlayError(null);
    }, [activeVideoSourceIdentity, recordingId]);

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

    // Opportunistically capture and upload a still-frame thumbnail for the
    // owner as soon as the first visible frame is ready. We skip editor-picked
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
          // Thumbnails are best-effort — never fail the player UI.
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
          setCurrentMs(visibleMs);
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

    // Reset the "Preparing your clip…" overlay whenever the video source
    // changes, and start a 10s safety timeout so the overlay can never stick.
    useEffect(() => {
      if (!activeVideoSrc) {
        setIsPreparing(false);
        return;
      }
      const v = videoRef.current;
      // If the video already has a frame ready (cached playback, re-render),
      // skip the overlay entirely.
      if (v && (v.readyState >= 2 || v.currentTime > 0)) {
        setIsPreparing(false);
        return;
      }
      setIsPreparing(true);
      const t = setTimeout(() => setIsPreparing(false), 10000);
      return () => clearTimeout(t);
    }, [activeVideoSrc]);

    useEffect(() => {
      bumpControls();
      return () => {
        if (idleTimer.current) clearTimeout(idleTimer.current);
      };
    }, [bumpControls]);

    // Keep isPip in sync with the browser's PiP state (React doesn't support
    // PiP events as JSX handlers; wire them via addEventListener instead).
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
      if (!el) return;
      try {
        if (!document.fullscreenElement) {
          await el.requestFullscreen();
          setIsFullscreen(true);
        } else {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      } catch (err) {
        console.warn("[clips] Fullscreen failed", err);
      }
    }

    useEffect(() => {
      const onFs = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", onFs);
      return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

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
    const centerOverlayMode =
      activeVideoSrc &&
      !isLoomEmbed &&
      !showEndCta &&
      (!isPlaying || isPlayPending || isBuffering)
        ? isPreparing || isPlayPending || isBuffering || !canPlay
          ? "loading"
          : "ready"
        : null;
    const centerOverlayLabel = isPlayPending
      ? "Starting playback"
      : isBuffering
        ? "Buffering"
        : "Preparing clip";

    return (
      <div
        ref={containerRef}
        className={cn(
          // `@container` lets the center play button scale with the player
          // width (see CenterPlaybackOverlay) so it isn't oversized inside
          // small embeds like the Slack unfurl iframe.
          "relative @container bg-black overflow-hidden select-none group",
          theaterMode ? "fixed inset-0 z-40" : "rounded-xl",
          className,
        )}
        onMouseMove={bumpControls}
        onMouseLeave={() => !alwaysShowControls && setShowControls(false)}
        onClick={(e) => {
          // Clicking the video toggles play — but not when clicking controls.
          const target = e.target as HTMLElement;
          if (target.closest("[data-player-ui]")) return;
          if (isLoomEmbed) return;
          togglePlayback();
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
        ) : activeVideoSrc ? (
          <video
            ref={videoRef}
            src={activeVideoSrc}
            poster={resolveLocalUrl(thumbnailUrl)}
            // `crossOrigin` is only needed so the owner's canvas thumbnail
            // capture isn't tainted. For everyone else (viewers, and the Slack
            // unfurl embed) it adds nothing — but if the player is ever framed
            // into a sandboxed/opaque-origin context (Slack double-iframes the
            // embed), the resulting CORS check on the media bytes fails and the
            // video won't load. Scope it to owners so embeds load cleanly.
            crossOrigin={role === "owner" ? "anonymous" : undefined}
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
              setIsPreparing(false);
              captureThumbnail();
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              // Chrome occasionally emits a timeupdate with currentTime=1e10
              // while we're probing the real duration. Clamp anything beyond
              // a plausible ceiling so the scrubber doesn't yank to the end.
              const raw = v.currentTime;
              const ct =
                Number.isFinite(raw) && raw >= 0 && raw < 1e7 ? raw : 0;
              const ms = Math.floor(ct * 1000);
              const visibleMs = clampSeek(
                skipExcludedRange(ms, excludedRanges, resolvedDurationMs),
                v,
                resolvedDurationMs,
              );
              if (visibleMs !== ms) {
                v.currentTime = visibleMs / 1000;
                setCurrentMs(visibleMs);
                if (visibleMs > 0) setHasPlaybackStarted(true);
                if (visibleMs > 0) setIsPreparing(false);
                onTimeUpdate?.(visibleMs, resolvedDurationMs);
                return;
              }
              setCurrentMs(ms);
              if (ms > 0) setHasPlaybackStarted(true);
              if (ms > 0) setIsPreparing(false);
              onTimeUpdate?.(ms, resolvedDurationMs);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setIsPlayPending(false);
              setIsBuffering(false);
              onEnded?.();
            }}
            onError={(e) => {
              playAttemptPendingRef.current = false;
              setIsPlayPending(false);
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

        {centerOverlayMode ? (
          <CenterPlaybackOverlay
            mode={centerOverlayMode}
            label={centerOverlayLabel}
            durationMs={resolvedDurationMs}
            speed={speed}
            playError={playError}
            onPlay={() => {
              // An explicit click means the user wants to watch with sound, so
              // undo the muted-autoplay default (see `muted` state) before we
              // start playback.
              const v = videoRef.current;
              if (v && v.muted) {
                v.muted = false;
                setMuted(false);
              }
              requestPlay();
            }}
            onSpeedChange={applySpeed}
            menuPortalContainer={fullscreenMenuContainer}
          />
        ) : null}

        {/* Captions */}
        {!hideCaptions &&
        !isLoomEmbed &&
        captionsOn &&
        hasPlaybackStarted &&
        currentSegment ? (
          <CaptionsOverlay text={currentSegment.text} />
        ) : null}

        {/* Floating CTA (throughout placement) */}
        {showThroughoutCta ? (
          <div data-player-ui className="absolute bottom-16 right-4 z-20">
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
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-4 text-white">
              <p className="text-lg font-medium">{t("videoPlayer.thanks")}</p>
              <CtaButton
                cta={cta!}
                onClick={() => onCtaClick?.(cta!.id)}
                large
              />
            </div>
          </div>
        ) : null}

        {/* Controls */}
        {!hideChrome && !isLoomEmbed ? (
          <div
            data-player-ui
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 transition-opacity duration-200",
              showControls ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <PlayerControls
              isPlaying={isPlaying}
              durationMs={resolvedDurationMs}
              currentMs={currentMs}
              volume={volume}
              muted={muted}
              speed={speed}
              captionsOn={captionsOn}
              isFullscreen={isFullscreen}
              isPip={isPip}
              theaterMode={!!theaterMode}
              comments={comments}
              chapters={chapters}
              reactions={reactions}
              excludedRanges={excludedRanges}
              hasCaptions={!!transcriptSegments?.length}
              onPlayPause={() => {
                togglePlayback();
              }}
              onSeek={(ms) => {
                seekToVisibleMs(ms);
              }}
              onVolumeChange={(vol) => {
                const v = videoRef.current;
                if (v) {
                  v.volume = vol;
                  v.muted = vol === 0;
                  setVolume(vol);
                  setMuted(vol === 0);
                }
              }}
              onToggleMute={() => {
                const v = videoRef.current;
                if (v) {
                  v.muted = !v.muted;
                  setMuted(v.muted);
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
            <button
              data-player-ui
              type="button"
              aria-label={t("videoPlayer.playClip")}
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              className="pointer-events-auto flex h-[clamp(3rem,13cqw,6rem)] w-[clamp(3rem,13cqw,6rem)] items-center justify-center rounded-full bg-white text-black shadow-2xl ring-1 ring-white/35 transition-transform duration-150 hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <IconPlayerPlay className="ml-[6%] h-[clamp(1.5rem,6.5cqw,3rem)] w-[clamp(1.5rem,6.5cqw,3rem)] fill-current" />
            </button>

            <div
              data-player-ui
              className="pointer-events-auto flex items-center gap-2 rounded-md bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 tabular-nums transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    {formatSpeedLabel(speed)}
                  </button>
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

            {playError ? (
              <p className="max-w-xs rounded-md bg-black/70 px-3 py-2 text-center text-xs font-medium text-white/85 ring-1 ring-white/10">
                {playError}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Clamp a millisecond seek target to a value the browser will actually accept.
 *
 * Chrome silently ignores `video.currentTime = X` when the media's duration is
 * `Infinity` (MediaRecorder-created WebM files without a Duration element in
 * their container). To work around that we upper-bound the seek by the most
 * trustworthy finite number we have — preferring the resolved duration from
 * the player, then falling back to `video.duration`, then the seekable range.
 */
function clampSeek(
  ms: number,
  v: HTMLVideoElement,
  resolvedDurationMs: number,
): number {
  let maxSec = Number.POSITIVE_INFINITY;
  if (resolvedDurationMs > 0) {
    maxSec = resolvedDurationMs / 1000;
  } else if (Number.isFinite(v.duration) && v.duration > 0) {
    maxSec = v.duration;
  } else if (v.seekable && v.seekable.length > 0) {
    maxSec = v.seekable.end(v.seekable.length - 1);
  }
  const sec = Math.max(0, Math.min(maxSec, ms / 1000));
  return Math.floor(sec * 1000);
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

/** Human-readable label for an HTMLMediaElement `error` (MediaError). */
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

/**
 * Surface a playback failure to the console and Sentry with enough context to
 * debug it remotely — e.g. when a clip "could not be loaded" inside a Slack
 * unfurl where there's no visible console. Best-effort; never throws. Expected,
 * benign cases (AbortError / autoplay-blocked NotAllowedError) are filtered out
 * by the callers and never reach here.
 */
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
