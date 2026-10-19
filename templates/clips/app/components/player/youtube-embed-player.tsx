import { useT } from "@agent-native/core/client/i18n";
import { youtubeVideoIdFromEmbedUrl, youtubeWatchUrl } from "@shared/youtube";
import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  parsePlaybackSpeed,
  readPlaybackSpeedPreference,
  savePlaybackSpeedPreference,
} from "@/lib/playback-speed";
import { cn } from "@/lib/utils";
import {
  loadYouTubeIframeApi,
  YOUTUBE_PLAYER_STATE,
  youtubePlaybackErrorFromCode,
  type YouTubePlaybackError,
  type YouTubePlayer,
} from "@/lib/youtube-iframe-api";

import { CtaButton } from "./cta-button";
import { PlayerControls } from "./player-controls";
import { useOptimisticReactions } from "./use-optimistic-reactions";
import type { VideoPlayerHandle, VideoPlayerProps } from "./video-player";

// YouTube exposes no time events, so the clock is read on an interval while
// playing. The page hears about it at the native player's timeupdate pace, and
// at once when playback crosses a transcript cue, so the highlight lands on
// its cue without re-rendering the whole page on every read.
const CLOCK_POLL_MS = 100;
const CLOCK_PUBLISH_MS = 250;
// A seek settles once YouTube's clock reads its target, or reads past it by no
// more than playback at YouTube's fastest rate could have carried it. Until
// then, for at most the timeout, the reported time is the pre-seek clock.
const SEEK_SETTLE_TOLERANCE_MS = 250;
const SEEK_SETTLE_TIMEOUT_MS = 1000;
const YOUTUBE_MAX_PLAYBACK_RATE = 2;
// A scrubber drag seeks on every pointer move and cueing reloads YouTube's
// video, so a seek before the first play is cued once the drag pauses.
const CUE_SETTLE_MS = 150;
const YOUTUBE_PLAYER_HOST = "https://www.youtube-nocookie.com";
const STARTED_STATES = new Set<number>([
  YOUTUBE_PLAYER_STATE.PLAYING,
  YOUTUBE_PLAYER_STATE.PAUSED,
  YOUTUBE_PLAYER_STATE.BUFFERING,
  YOUTUBE_PLAYER_STATE.ENDED,
]);

const ERROR_MESSAGE_KEYS: Record<YouTubePlaybackError, string> = {
  unavailable: "videoPlayer.youtubeUnavailable",
  embed_blocked: "videoPlayer.youtubeEmbedBlocked",
  invalid: "videoPlayer.youtubeInvalid",
  playback: "videoPlayer.youtubePlaybackFailed",
  api_unavailable: "videoPlayer.youtubeApiUnavailable",
};

// Before YouTube reports its first state, its getters can return undefined.
function readSeconds(read: () => number): number | null {
  const seconds = read();
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Plays a YouTube-backed clip inside YouTube's embedded player with the same
 * handle as a native clip. Nothing is downloaded: Clips only reads YouTube's
 * clock and drives its transport controls, so there are no frames to step
 * through or capture.
 *
 * YouTube's player policy forbids drawing anything in front of its player, so
 * the controls sit below it, and the captions and comment bubbles a native
 * clip draws over the video are left out.
 */
export const YouTubeEmbedPlayer = forwardRef<
  VideoPlayerHandle,
  VideoPlayerProps
>(function YouTubeEmbedPlayer(props, ref) {
  const t = useT();
  const {
    videoUrl,
    durationMs,
    defaultSpeed = 1.2,
    autoPlay,
    startMs,
    comments,
    chapters,
    reactions,
    transcriptSegments,
    theaterMode,
    onTheaterToggle,
    cta,
    onCtaClick,
    onTimeUpdate,
    onDurationChange,
    onPlay,
    onPause,
    onSeek,
    onSpeedChange,
    onEnded,
    className,
    hideChrome,
    enableReactions,
    onReact,
    enableComments,
    onAddComment,
    onFullscreenChange,
  } = props;
  const videoId = useMemo(
    () => youtubeVideoIdFromEmbedUrl(videoUrl),
    [videoUrl],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [isPlayerMounted, setIsPlayerMounted] = useState(false);
  const [error, setError] = useState<YouTubePlaybackError | null>(
    videoId ? null : "invalid",
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(startMs ?? 0);
  const currentMsRef = useRef(startMs ?? 0);
  const [playerDurationMs, setPlayerDurationMs] = useState(0);
  const playerDurationMsRef = useRef(0);
  const [speed, setSpeed] = useState(() =>
    readPlaybackSpeedPreference(defaultSpeed),
  );
  const [speedOptions, setSpeedOptions] = useState<number[] | undefined>();
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(() => !!autoPlay);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // A seek before the first play cues the video at that time instead of
  // starting it, so the viewer still decides when it plays.
  const cuedStartMsRef = useRef<number | null>(
    startMs && startMs > 0 ? startMs : null,
  );
  const cueTimerRef = useRef<number | null>(null);
  const playWhenReadyRef = useRef(false);
  const pendingSeekRef = useRef<{ ms: number; at: number } | null>(null);

  // The stored duration is the first one measured, which for a live stream is
  // only its length so far.
  const resolvedDurationMs =
    playerDurationMs > 0 ? playerDurationMs : durationMs;
  const resolvedDurationMsRef = useRef(resolvedDurationMs);
  resolvedDurationMsRef.current = resolvedDurationMs;

  // YouTube's events are bound once per player, so they read the latest props
  // through this ref.
  const callbacksRef = useRef({
    onTimeUpdate,
    onDurationChange,
    onPlay,
    onPause,
    onEnded,
    onSpeedChange,
  });
  callbacksRef.current = {
    onTimeUpdate,
    onDurationChange,
    onPlay,
    onPause,
    onEnded,
    onSpeedChange,
  };

  const publishTime = useCallback((ms: number) => {
    currentMsRef.current = ms;
    setCurrentMs(ms);
    callbacksRef.current.onTimeUpdate?.(ms, resolvedDurationMsRef.current);
  }, []);

  const hasStarted = useCallback(
    (player: YouTubePlayer) => STARTED_STATES.has(player.getPlayerState()),
    [],
  );

  const readPlayerDuration = useCallback((player: YouTubePlayer) => {
    const seconds = readSeconds(() => player.getDuration());
    if (!seconds) return;
    const ms = Math.round(seconds * 1000);
    if (ms === playerDurationMsRef.current) return;
    playerDurationMsRef.current = ms;
    setPlayerDurationMs(ms);
    callbacksRef.current.onDurationChange?.(ms);
  }, []);

  // The API relays YouTube's clock by message, so right after seekTo() it
  // still reports the old time; a second quick seek would start from there.
  const readPlayerMs = useCallback(
    (player: YouTubePlayer) => {
      if (!hasStarted(player)) return null;
      const seconds = readSeconds(() => player.getCurrentTime());
      if (seconds === null) return null;
      const ms = Math.floor(seconds * 1000);
      const seek = pendingSeekRef.current;
      if (seek) {
        const elapsedMs = performance.now() - seek.at;
        const settled =
          ms >= seek.ms - SEEK_SETTLE_TOLERANCE_MS &&
          ms <=
            seek.ms +
              elapsedMs * YOUTUBE_MAX_PLAYBACK_RATE +
              SEEK_SETTLE_TOLERANCE_MS;
        if (!settled && elapsedMs < SEEK_SETTLE_TIMEOUT_MS) return seek.ms;
        pendingSeekRef.current = null;
      }
      return ms;
    },
    [hasStarted],
  );

  const syncClock = useCallback(() => {
    const player = playerRef.current;
    const ms = player ? readPlayerMs(player) : null;
    if (ms !== null && ms !== currentMsRef.current) publishTime(ms);
  }, [publishTime, readPlayerMs]);

  const cueBoundaries = useMemo(
    () => (transcriptSegments ?? []).flatMap((s) => [s.startMs, s.endMs]),
    [transcriptSegments],
  );
  const cueBoundariesRef = useRef(cueBoundaries);
  cueBoundariesRef.current = cueBoundaries;

  const pollClock = useCallback(() => {
    const player = playerRef.current;
    const ms = player ? readPlayerMs(player) : null;
    if (ms === null) return;
    const lastMs = currentMsRef.current;
    const crossedCue = cueBoundariesRef.current.some(
      (boundaryMs) => lastMs < boundaryMs && boundaryMs <= ms,
    );
    if (ms >= lastMs && ms - lastMs < CLOCK_PUBLISH_MS && !crossedCue) return;
    publishTime(ms);
  }, [publishTime, readPlayerMs]);

  useEffect(() => {
    if (!videoId) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let player: YouTubePlayer | null = null;
    const mount = document.createElement("div");
    host.replaceChildren(mount);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        const initialSpeed = readPlaybackSpeedPreference(defaultSpeed);
        const cuedStartMs = cuedStartMsRef.current;
        player = new YT.Player(mount, {
          host: YOUTUBE_PLAYER_HOST,
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: autoPlay ? 1 : 0,
            // Browsers only autoplay muted video.
            mute: autoPlay ? 1 : 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin,
            ...(cuedStartMs ? { start: Math.floor(cuedStartMs / 1000) } : {}),
          },
          events: {
            onReady: ({ target }) => {
              if (cancelled) return;
              playerRef.current = target;
              target.setPlaybackRate(initialSpeed);
              setSpeed(target.getPlaybackRate() || initialSpeed);
              const rates = target.getAvailablePlaybackRates();
              if (rates.length) setSpeedOptions(rates);
              readPlayerDuration(target);
              const shouldPlay = autoPlay || playWhenReadyRef.current;
              playWhenReadyRef.current = false;
              const startAtMs = cuedStartMsRef.current;
              // `start` only takes whole seconds; cueing keeps a seek made
              // before the player was ready exact without starting playback.
              if (startAtMs !== null && !shouldPlay) {
                target.cueVideoById({
                  videoId,
                  startSeconds: startAtMs / 1000,
                });
              } else if (startAtMs !== null) {
                target.seekTo(startAtMs / 1000, true);
              }
              if (shouldPlay) target.playVideo();
            },
            onStateChange: ({ target, data }) => {
              if (cancelled) return;
              readPlayerDuration(target);
              switch (data) {
                case YOUTUBE_PLAYER_STATE.PLAYING:
                  cuedStartMsRef.current = null;
                  setIsPlaying(true);
                  syncClock();
                  callbacksRef.current.onPlay?.();
                  break;
                case YOUTUBE_PLAYER_STATE.PAUSED:
                  setIsPlaying(false);
                  syncClock();
                  callbacksRef.current.onPause?.();
                  break;
                case YOUTUBE_PLAYER_STATE.ENDED: {
                  setIsPlaying(false);
                  const endMs = resolvedDurationMsRef.current;
                  publishTime(endMs > 0 ? endMs : currentMsRef.current);
                  callbacksRef.current.onEnded?.();
                  break;
                }
              }
            },
            onPlaybackRateChange: ({ data }) => {
              if (cancelled) return;
              setSpeed(data);
              callbacksRef.current.onSpeedChange?.(data);
            },
            onError: ({ data }) => {
              if (cancelled) return;
              setIsPlaying(false);
              setError(youtubePlaybackErrorFromCode(data));
            },
          },
        });
        setIsPlayerMounted(true);
      })
      .catch(() => {
        if (!cancelled) setError("api_unavailable");
      });

    return () => {
      cancelled = true;
      if (cueTimerRef.current !== null) {
        window.clearTimeout(cueTimerRef.current);
        cueTimerRef.current = null;
      }
      playerRef.current = null;
      setIsPlayerMounted(false);
      try {
        player?.destroy();
        // coercion-ok: teardown has no caller to report to, and the host is cleared next
      } catch {
        // The iframe may already be gone with its host.
      }
      host.replaceChildren();
    };
    // The player is rebuilt only for a different video; later prop changes
    // go through its API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(pollClock, CLOCK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying, pollClock]);

  const getLiveMs = useCallback(() => {
    const player = playerRef.current;
    return (player ? readPlayerMs(player) : null) ?? currentMsRef.current;
  }, [readPlayerMs]);

  const requestPlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      playWhenReadyRef.current = true;
      return;
    }
    const cuedStartMs = cuedStartMsRef.current;
    if (cueTimerRef.current !== null && cuedStartMs !== null) {
      // Start from the latest seek, which isn't cued yet.
      window.clearTimeout(cueTimerRef.current);
      cueTimerRef.current = null;
      player.seekTo(cuedStartMs / 1000, true);
    }
    player.playVideo();
  }, []);

  const pauseVideo = useCallback(() => {
    playWhenReadyRef.current = false;
    playerRef.current?.pauseVideo();
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) pauseVideo();
    else requestPlay();
  }, [isPlaying, pauseVideo, requestPlay]);

  const seekTo = useCallback(
    (ms: number) => {
      const durationLimit = resolvedDurationMsRef.current;
      const clamped = Math.max(
        0,
        durationLimit > 0 ? Math.min(ms, durationLimit) : ms,
      );
      const player = playerRef.current;
      if (player && hasStarted(player)) {
        pendingSeekRef.current = { ms: clamped, at: performance.now() };
        player.seekTo(clamped / 1000, true);
      } else {
        cuedStartMsRef.current = clamped;
        if (cueTimerRef.current !== null) {
          window.clearTimeout(cueTimerRef.current);
        }
        cueTimerRef.current = window.setTimeout(() => {
          cueTimerRef.current = null;
          const current = playerRef.current;
          const cueMs = cuedStartMsRef.current;
          if (current && videoId && cueMs !== null && !hasStarted(current)) {
            current.cueVideoById({ videoId, startSeconds: cueMs / 1000 });
          }
        }, CUE_SETTLE_MS);
      }
      publishTime(clamped);
      onSeek?.(clamped);
    },
    [hasStarted, onSeek, publishTime, videoId],
  );

  const seekByMs = useCallback(
    (deltaMs: number) => seekTo(getLiveMs() + deltaMs),
    [getLiveMs, seekTo],
  );

  const applySpeed = useCallback(
    (rate: number) => {
      const nextSpeed = parsePlaybackSpeed(rate) ?? defaultSpeed;
      savePlaybackSpeedPreference(nextSpeed);
      const player = playerRef.current;
      if (!player) {
        setSpeed(nextSpeed);
        onSpeedChange?.(nextSpeed);
        return;
      }
      // YouTube rounds to a rate it supports and reports it through
      // onPlaybackRateChange, so the control shows the rate actually used.
      player.setPlaybackRate(nextSpeed);
    },
    [defaultSpeed, onSpeedChange],
  );

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isMuted()) player.unMute();
    else player.mute();
    setMuted(!muted);
  }, [muted]);

  const changeVolume = useCallback((nextVolume: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(Math.round(nextVolume * 100));
    if (nextVolume === 0) player.mute();
    else player.unMute();
    setVolume(nextVolume);
    setMuted(nextVolume === 0);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (typeof el.requestFullscreen === "function") {
        await el.requestFullscreen();
      }
    } catch (err) {
      console.warn("[clips] fullscreen failed", err);
    }
  }, []);

  useEffect(() => {
    const onFs = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    onFullscreenChange?.(isFullscreen);
  }, [isFullscreen, onFullscreenChange]);

  useImperativeHandle(
    ref,
    () => ({
      video: null,
      get container() {
        return containerRef.current;
      },
      play: requestPlay,
      pause: pauseVideo,
      seek: seekTo,
      getCurrentOriginalMs: getLiveMs,
      readPlayback: () => {
        const liveMs = getLiveMs();
        return {
          paused: !isPlaying,
          currentMs: liveMs,
          durationMs: resolvedDurationMsRef.current || liveMs,
          volume,
          speed,
        };
      },
      setVolume: changeVolume,
      // An embedded player exposes no frames to step through.
      stepFrame: () => {},
      setSpeed: applySpeed,
      toggleMute,
      // Captions would have to be drawn over YouTube's player.
      toggleCaptions: () => {},
      toggleFullscreen: () => void toggleFullscreen(),
      togglePip: () => {},
    }),
    [
      applySpeed,
      changeVolume,
      getLiveMs,
      isPlaying,
      pauseVideo,
      requestPlay,
      seekTo,
      speed,
      toggleFullscreen,
      toggleMute,
      volume,
    ],
  );

  const getReactionMs = useCallback(() => currentMsRef.current, []);
  const { optimisticReactions, handleReact } = useOptimisticReactions({
    reactions,
    onReact,
    getCurrentMs: getReactionMs,
  });
  const timelineReactions = useMemo(
    () => [...(reactions ?? []), ...optimisticReactions],
    [optimisticReactions, reactions],
  );

  const showCta =
    !!cta &&
    (cta.placement === "throughout" ||
      (cta.placement === "end" &&
        resolvedDurationMs > 0 &&
        currentMs >= resolvedDurationMs - 200));
  const fillsViewport = !!theaterMode || isFullscreen;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative @container flex flex-col overflow-hidden bg-player-control select-none group",
        fillsViewport ? "fixed inset-0 z-40 h-dvh w-dvw" : "rounded-xl",
        className,
      )}
    >
      {/* YouTube requires 200 px of player height; the ratio sizes it in a
          page and the flex fills a theater or fullscreen frame. */}
      <div className="relative aspect-video min-h-[200px] w-full flex-auto">
        {error ? (
          <YouTubeErrorPanel
            message={t(ERROR_MESSAGE_KEYS[error])}
            watchUrl={videoId ? youtubeWatchUrl(videoId) : null}
            watchLabel={t("videoPlayer.watchOnYouTube")}
          />
        ) : (
          <div
            ref={hostRef}
            className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0"
          />
        )}
        {!error && !isPlayerMounted ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-live="polite"
          >
            <Spinner
              className="h-8 w-8 text-player-control-foreground/85"
              aria-label={t("videoPlayer.youtubeLoading")}
            />
          </div>
        ) : null}
      </div>

      {!error && !hideChrome ? (
        <PlayerControls
          docked
          isPlaying={isPlaying}
          durationMs={resolvedDurationMs}
          currentMs={currentMs}
          volume={volume}
          muted={muted}
          speed={speed}
          speedOptions={speedOptions}
          captionsOn={false}
          hasCaptions={false}
          isFullscreen={isFullscreen}
          isPip={false}
          canPip={false}
          theaterMode={!!theaterMode}
          comments={comments}
          chapters={chapters}
          reactions={timelineReactions}
          onPlayPause={togglePlayback}
          onSeek={seekTo}
          onSeekRelative={seekByMs}
          onVolumeChange={changeVolume}
          onToggleMute={toggleMute}
          onSpeedChange={applySpeed}
          onToggleCaptions={() => {}}
          onTogglePip={() => {}}
          onToggleFullscreen={() => void toggleFullscreen()}
          onToggleTheater={onTheaterToggle}
          menuPortalContainer={isFullscreen ? containerRef.current : null}
          showReactionsAndComment={isFullscreen}
          enableReactions={enableReactions}
          onReact={handleReact}
          enableComments={enableComments}
          onAddComment={onAddComment}
        />
      ) : null}

      {!error && showCta && cta ? (
        <div data-player-ui className="flex justify-end px-3 pb-3">
          <CtaButton cta={cta} onClick={() => onCtaClick?.(cta.id)} />
        </div>
      ) : null}
    </div>
  );
});

function YouTubeErrorPanel({
  message,
  watchUrl,
  watchLabel,
}: {
  message: string;
  watchUrl: string | null;
  watchLabel: string;
}) {
  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-player-control px-6 text-center text-player-control-foreground"
    >
      <IconAlertTriangle
        className="h-8 w-8 text-player-control-foreground/70"
        aria-hidden
      />
      <p className="max-w-sm text-sm font-medium text-player-control-foreground/85">
        {message}
      </p>
      {watchUrl ? (
        <Button
          asChild
          variant="secondary"
          size="sm"
          className="border-player-control-foreground/30 bg-player-control-foreground/10 text-player-control-foreground hover:bg-player-control-foreground/20 hover:text-player-control-foreground"
        >
          <a href={watchUrl} target="_blank" rel="noopener noreferrer">
            <IconExternalLink />
            {watchLabel}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
