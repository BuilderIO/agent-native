import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { appBasePath, captureClientException } from "@agent-native/core/client";
import { IconPlayerPlay } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlayerControls, SPEED_OPTIONS } from "./player-controls";
import { CaptionsOverlay } from "./captions-overlay";
import { CtaButton } from "./cta-button";
import { msToClock } from "./scrubber";
import {
  getExcludedRanges,
  parseEdits,
  type TrimRange,
} from "@/lib/timestamp-mapping";
import {
  captureVideoThumbnailBlob,
  thumbnailUrlHasVisibleContent,
  uploadRecordingThumbnail,
} from "@/lib/thumbnail-capture";

function resolveLocalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) {
    return `${appBasePath()}${url}`;
  }
  return url;
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
   * Viewer role for this recording. When `owner` (and `thumbnailUrl` is not
   * already set) we opportunistically capture the first rendered frame and
   * POST it to `/api/recordings/:id/thumbnail` so the library grid has a
   * real thumbnail on future loads — fixes clips recorded before the
   * thumbnail-capture feature shipped.
   */
  role?: "owner" | "admin" | "editor" | "viewer";
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(props, ref) {
    const {
      videoUrl,
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
      onEnded,
      className,
      alwaysShowControls,
      hideChrome,
      hideCaptions,
      cover,
      recordingId,
      role,
    } = props;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const playAttemptPendingRef = useRef(false);
    const playAttemptIdRef = useRef(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(startMs ?? 0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [speed, setSpeed] = useState(defaultSpeed);
    const [showControls, setShowControls] = useState(true);
    const [captionsOn, setCaptionsOn] = useState(false);
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
        if (name === "AbortError") return;

        console.warn("[clips] playback start failed", err);
        setPlayError("Could not start playback. Try again.");
      },
      [],
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
      if (!v || !videoUrl) return;
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
    }, [attachPlayPromise, bumpControls, rejectPlayAttempt, videoUrl]);

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

    const applySpeed = useCallback((rate: number) => {
      if (videoRef.current) videoRef.current.playbackRate = rate;
      setSpeed(rate);
    }, []);

    const seekToVisibleMs = useCallback(
      (ms: number) => {
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
      [excludedRanges, onSeek, resolvedDurationMs],
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
      v.playbackRate = defaultSpeed;
      setSpeed(defaultSpeed);
      if (startMs && startMs > 0) {
        const visibleMs = clampSeek(
          skipExcludedRange(startMs, excludedRanges, resolvedDurationMs),
          v,
          resolvedDurationMs,
        );
        v.currentTime = visibleMs / 1000;
        setCurrentMs(visibleMs);
      }
    }, [defaultSpeed, excludedRanges, resolvedDurationMs, startMs, videoUrl]);

    // Keep the resolved duration in sync with the prop when it changes (new
    // recording loaded, etc.) — only bump it if the prop is a real number.
    useEffect(() => {
      if (Number.isFinite(durationMs) && durationMs > 0) {
        setResolvedDurationMs(durationMs);
      }
      durationProbedRef.current = false;
    }, [durationMs, videoUrl]);

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

      const onLoadedMetadata = () => {
        if (durationProbedRef.current) return;
        if (!Number.isFinite(v.duration) || v.duration === 0) {
          // Poke the browser into computing the real duration.
          durationProbedRef.current = true;
          try {
            v.currentTime = 1e10;
          } catch {
            // Safari occasionally throws — the durationchange fallback
            // handler below still picks up the real duration.
          }
        } else {
          durationProbedRef.current = true;
          setResolvedDurationMs(Math.round(v.duration * 1000));
        }
      };

      const onDurationChange = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          setResolvedDurationMs(Math.round(v.duration * 1000));
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
      if (v.readyState >= 1) onLoadedMetadata();

      return () => {
        v.removeEventListener("loadedmetadata", onLoadedMetadata);
        v.removeEventListener("durationchange", onDurationChange);
      };
    }, [videoUrl]);

    // Reset the thumbnail-capture flag when the source changes (e.g. the
    // player is reused for a different recording via React Router).
    useEffect(() => {
      thumbnailCapturedRef.current = false;
      initialVisibleFrameSeekedRef.current = false;
      playAttemptIdRef.current += 1;
      playAttemptPendingRef.current = false;
      setCanPlay(false);
      setIsPlayPending(false);
      setIsBuffering(false);
      setPlayError(null);
    }, [recordingId, videoUrl]);

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
      [autoPlay, excludedRanges, resolvedDurationMs, startMs],
    );

    // Reset the "Preparing your clip…" overlay whenever the video source
    // changes, and start a 10s safety timeout so the overlay can never stick.
    useEffect(() => {
      if (!videoUrl) {
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
    }, [videoUrl]);

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
    }, [videoUrl]);

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

    const showThroughoutCta = cta && cta.placement === "throughout";
    const centerOverlayMode =
      videoUrl && !showEndCta && (!isPlaying || isPlayPending || isBuffering)
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
          "relative bg-black overflow-hidden select-none group",
          theaterMode ? "fixed inset-0 z-40" : "rounded-xl",
          className,
        )}
        onMouseMove={bumpControls}
        onMouseLeave={() => !alwaysShowControls && setShowControls(false)}
        onClick={(e) => {
          // Clicking the video toggles play — but not when clicking controls.
          const target = e.target as HTMLElement;
          if (target.closest("[data-player-ui]")) return;
          togglePlayback();
        }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={resolveLocalUrl(videoUrl)}
            poster={resolveLocalUrl(thumbnailUrl)}
            className={cn(
              "w-full h-full",
              cover ? "object-cover" : "object-contain",
            )}
            autoPlay={autoPlay}
            playsInline
            onLoadStart={() => {
              setCanPlay(false);
              setIsPreparing(true);
              setIsBuffering(false);
              setPlayError(null);
            }}
            onPlay={() => {
              setIsPlaying(true);
              onPlay?.();
            }}
            onPlaying={() => {
              setIsPlaying(true);
              setCanPlay(true);
              setIsPreparing(false);
              setIsBuffering(false);
              resolvePlayAttempt(playAttemptIdRef.current);
            }}
            onPause={() => {
              setIsPlaying(false);
              playAttemptPendingRef.current = false;
              setIsPlayPending(false);
              setIsBuffering(false);
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
                if (visibleMs > 0) setIsPreparing(false);
                onTimeUpdate?.(visibleMs, resolvedDurationMs);
                return;
              }
              setCurrentMs(ms);
              if (ms > 0) setIsPreparing(false);
              onTimeUpdate?.(ms, resolvedDurationMs);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setIsPlayPending(false);
              setIsBuffering(false);
              onEnded?.();
            }}
            onError={() => {
              playAttemptPendingRef.current = false;
              setIsPlayPending(false);
              setIsBuffering(false);
              setIsPreparing(false);
              setPlayError("Video could not be loaded.");
            }}
            onVolumeChange={(e) => {
              setVolume(e.currentTarget.volume);
              setMuted(e.currentTarget.muted);
            }}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
            No video available
          </div>
        )}

        {centerOverlayMode ? (
          <CenterPlaybackOverlay
            mode={centerOverlayMode}
            label={centerOverlayLabel}
            durationMs={resolvedDurationMs}
            speed={speed}
            playError={playError}
            onPlay={requestPlay}
            onSpeedChange={applySpeed}
          />
        ) : null}

        {/* Captions */}
        {!hideCaptions && captionsOn && currentSegment ? (
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
              <p className="text-lg font-medium">Thanks for watching</p>
              <CtaButton
                cta={cta!}
                onClick={() => onCtaClick?.(cta!.id)}
                large
              />
            </div>
          </div>
        ) : null}

        {/* Controls */}
        {!hideChrome ? (
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
}: {
  mode: "loading" | "ready";
  label: string;
  durationMs: number;
  speed: number;
  playError: string | null;
  onPlay: () => void;
  onSpeedChange: (rate: number) => void;
}) {
  const showLoading = mode === "loading" && !playError;

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
              aria-label="Play clip"
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              className="pointer-events-auto flex h-24 w-24 items-center justify-center rounded-full bg-white text-black shadow-2xl ring-1 ring-white/35 transition-transform duration-150 hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <IconPlayerPlay className="ml-1 h-12 w-12 fill-current" />
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
              <span className="min-w-12 text-center tabular-nums">
                {msToClock(durationMs)}
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
