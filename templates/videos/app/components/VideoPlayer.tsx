import { Player, type PlayerRef } from "@remotion/player";
import type { CompositionEntry } from "@/remotion/registry";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  Repeat,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type VideoPlayerHandle = {
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  getCurrentFrame: () => number;
};

type VideoPlayerProps = {
  composition: CompositionEntry;
  onFrameUpdate?: (frame: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** Constrain playback to this range (frames). Defaults to full duration. */
  viewStart?: number;
  viewEnd?: number;
  /** Initial frame to seek to on mount */
  initialFrame?: number;
};

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      composition,
      onFrameUpdate,
      onPlayingChange,
      playbackRate = 1,
      onPlaybackRateChange,
      viewStart = 0,
      viewEnd,
      initialFrame = 0,
    },
    ref,
  ) {
    const playerRef = useRef<PlayerRef>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [playing, setPlaying] = useState(false);
    const [currentFrame, setCurrentFrame] = useState(initialFrame);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [repeat, setRepeat] = useState(false);

    // Ref so the frameupdate handler sees latest repeat value without re-registering
    const repeatRef = useRef(false);
    repeatRef.current = repeat;

    // Validate and sanitize viewStart
    const safeViewStart = Number.isFinite(viewStart)
      ? Math.max(0, viewStart)
      : 0;

    // Resolved range end — defaults to full duration
    const rangeEnd = Number.isFinite(viewEnd)
      ? Math.min(viewEnd, composition.durationInFrames)
      : composition.durationInFrames;

    // Keep a ref so the frameupdate handler always sees the latest range
    // without needing to be re-registered on every change.
    const rangeRef = useRef({ start: safeViewStart, end: rangeEnd });
    rangeRef.current = { start: safeViewStart, end: rangeEnd };

    useImperativeHandle(ref, () => ({
      seekTo: (frame: number) => {
        // Safety check: ensure frame is a valid finite number
        if (!Number.isFinite(frame)) {
          console.error("VideoPlayer.seekTo: Invalid frame value", frame);
          return;
        }
        playerRef.current?.seekTo(frame);
        setCurrentFrame(frame);
        onFrameUpdate?.(frame);
      },
      play: () => playerRef.current?.play(),
      pause: () => playerRef.current?.pause(),
      toggle: () => {
        if (playing) playerRef.current?.pause();
        else playerRef.current?.play();
      },
      getCurrentFrame: () => currentFrame,
    }));

    useEffect(() => {
      const player = playerRef.current;
      if (!player) return;

      const onPlay = () => {
        setPlaying(true);
        onPlayingChange?.(true);
      };
      const onPause = () => {
        setPlaying(false);
        onPlayingChange?.(false);
      };
      const onFrame = (e: { detail: { frame: number } }) => {
        const frame = e.detail.frame;
        const { start, end } = rangeRef.current;

        // Safety check: ensure all values are finite
        if (
          !Number.isFinite(frame) ||
          !Number.isFinite(start) ||
          !Number.isFinite(end)
        ) {
          console.error("VideoPlayer.onFrame: Invalid values", {
            frame,
            start,
            end,
          });
          return;
        }

        // Enforce range end
        if (frame >= end) {
          if (repeatRef.current) {
            // Loop: jump back to start and keep playing
            player.seekTo(start);
            setCurrentFrame(start);
            onFrameUpdate?.(start);
          } else {
            // Stop
            player.pause();
            player.seekTo(start);
            setCurrentFrame(start);
            onFrameUpdate?.(start);
            setPlaying(false);
            onPlayingChange?.(false);
          }
          return;
        }

        setCurrentFrame(frame);
        onFrameUpdate?.(frame);
      };
      const onEnded = () => {
        setPlaying(false);
        setCurrentFrame(rangeRef.current.start);
        onPlayingChange?.(false);
        onFrameUpdate?.(rangeRef.current.start);
      };

      player.addEventListener("play", onPlay);
      player.addEventListener("pause", onPause);
      player.addEventListener("frameupdate", onFrame as any);
      player.addEventListener("ended", onEnded);

      return () => {
        player.removeEventListener("play", onPlay);
        player.removeEventListener("pause", onPause);
        player.removeEventListener("frameupdate", onFrame as any);
        player.removeEventListener("ended", onEnded);
      };
    }, [composition.id, onFrameUpdate, onPlayingChange]);

    // Seek to initialFrame when player is ready
    useEffect(() => {
      console.log(
        "VideoPlayer - seeking to initialFrame:",
        initialFrame,
        "playerRef ready:",
        !!playerRef.current,
      );
      if (playerRef.current && initialFrame > 0) {
        playerRef.current.seekTo(initialFrame);
        setCurrentFrame(initialFrame);
        onFrameUpdate?.(initialFrame);
      }
    }, [composition.id, initialFrame, onFrameUpdate]);

    // Reset when composition changes
    useEffect(() => {
      setPlaying(false);
      setCurrentFrame(initialFrame);
      playerRef.current?.pause();
      playerRef.current?.seekTo(initialFrame);
    }, [composition.id, initialFrame]);

    // When the range changes while paused, nudge the playhead to viewStart
    // if the current frame fell outside the new window.
    useEffect(() => {
      if (playing) return;
      if (currentFrame < viewStart || currentFrame >= rangeEnd) {
        playerRef.current?.seekTo(viewStart);
        setCurrentFrame(viewStart);
        onFrameUpdate?.(viewStart);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewStart, rangeEnd]);

    const togglePlay = useCallback(() => {
      if (playing) {
        playerRef.current?.pause();
      } else {
        // If parked at or past the end, restart from range start
        if (currentFrame >= rangeEnd) {
          playerRef.current?.seekTo(viewStart);
          setCurrentFrame(viewStart);
          onFrameUpdate?.(viewStart);
        }
        playerRef.current?.play();
      }
    }, [playing, currentFrame, rangeEnd, viewStart, onFrameUpdate]);

    // ⏮ goes to range start (not absolute 0)
    const restart = useCallback(() => {
      playerRef.current?.pause();
      playerRef.current?.seekTo(viewStart);
      setCurrentFrame(viewStart);
      setPlaying(false);
      onFrameUpdate?.(viewStart);
      onPlayingChange?.(false);
    }, [viewStart, onFrameUpdate, onPlayingChange]);

    const toggleFullscreen = useCallback(() => {
      if (!containerRef.current) return;
      if (document.fullscreenElement) {
        document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    }, []);

    useEffect(() => {
      const handler = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", handler);
      return () => document.removeEventListener("fullscreenchange", handler);
    }, []);

    // Progress within the active range (0–1)
    const rangeDuration = Math.max(1, rangeEnd - viewStart);
    const rangeProgress = Math.max(
      0,
      Math.min(1, (currentFrame - viewStart) / rangeDuration),
    );

    const currentTime = currentFrame / composition.fps;
    const totalTime = composition.durationInFrames / composition.fps;
    // Range bounds in seconds, for the time display
    const rangeStartTime = viewStart / composition.fps;
    const rangeEndTime = rangeEnd / composition.fps;
    const isRanged = viewStart > 0 || rangeEnd < composition.durationInFrames;

    const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 10);
      return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / rect.width));
      // Seek within the active range
      const targetFrame = Math.round(viewStart + fraction * rangeDuration);
      playerRef.current?.seekTo(targetFrame);
      setCurrentFrame(targetFrame);
      onFrameUpdate?.(targetFrame);
    };

    return (
      <div
        ref={containerRef}
        className="flex flex-col bg-black rounded-t-xl overflow-hidden border border-border"
      >
        {/* Player area */}
        <div className="relative w-full bg-black flex items-center justify-center overflow-hidden">
          <div
            className="w-full mx-auto"
            style={{
              aspectRatio: `${composition.width}/${composition.height}`,
              maxHeight: "55vh",
              // Prevent layout thrashing
              contain: "layout style paint",
              // Hardware acceleration
              transform: "translateZ(0)",
              backfaceVisibility: "hidden",
              perspective: 1000,
            }}
          >
            <Player
              ref={playerRef}
              component={composition.component}
              compositionWidth={composition.width}
              compositionHeight={composition.height}
              durationInFrames={composition.durationInFrames}
              fps={composition.fps}
              inputProps={composition.defaultProps}
              style={{
                width: "100%",
                height: "100%",
                // Hardware acceleration hints
                transform: "translateZ(0)",
                willChange: "transform",
              }}
              autoPlay={false}
              loop={false}
              controls={false}
              showVolumeControls={false}
              clickToPlay={false}
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              moveToBeginningWhenEnded={false}
              playbackRate={playbackRate}
              renderLoading={() => <div />}
              errorFallback={() => <div />}
              // Performance optimizations
              alwaysShowControls={false}
              showPosterWhenUnplayed={false}
              showPosterWhenEnded={false}
              showPosterWhenPaused={false}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-2 px-4 py-3 bg-card/90 backdrop-blur-sm border-t border-border">
          {/* Progress bar — scoped to active range */}
          <div
            className="group relative w-full h-1.5 bg-secondary rounded-full cursor-pointer hover:h-2.5 transition-all"
            onClick={handleSeek}
          >
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full transition-none"
              style={{ width: `${rangeProgress * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
              style={{ left: `calc(${rangeProgress * 100}% - 6px)` }}
            />
          </div>

          {/* Buttons + time */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <button
                onClick={restart}
                title="Go to start"
                aria-label="Go to start"
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
              >
                <SkipBack size={15} />
              </button>
              <button
                onClick={togglePlay}
                title={playing ? "Pause" : "Play"}
                aria-label={playing ? "Pause" : "Play"}
                className="p-2 text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button
                onClick={() => setRepeat((r) => !r)}
                title={repeat ? "Loop: on" : "Loop: off"}
                aria-label={repeat ? "Disable loop" : "Enable loop"}
                className={cn(
                  "p-2 rounded-lg transition-colors hover:bg-secondary",
                  repeat
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Repeat size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Time readout — clean and compact */}
              <span className="text-xs font-mono tabular-nums text-foreground/70">
                {formatTime(currentTime)}
                <span className="text-muted-foreground/40">
                  {" "}
                  / {formatTime(isRanged ? rangeEndTime : totalTime)}
                </span>
              </span>

              {/* Range pill — only shown when sub-range is active */}
              {isRanged && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-primary/10 text-primary/70 border border-primary/20 tabular-nums">
                  {formatTime(rangeStartTime)}–{formatTime(rangeEndTime)}
                </span>
              )}

              <span className="text-[10px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/30 font-mono tabular-nums">
                Frame {currentFrame}
              </span>

              {/* Playback speed dropdown */}
              <Select
                value={String(playbackRate)}
                onValueChange={(val) => onPlaybackRateChange?.(parseFloat(val))}
              >
                <SelectTrigger
                  className="h-auto text-[10px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border font-mono cursor-pointer w-auto gap-1"
                  title="Playback speed"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.25">0.25×</SelectItem>
                  <SelectItem value="0.5">0.5×</SelectItem>
                  <SelectItem value="0.75">0.75×</SelectItem>
                  <SelectItem value="1">1×</SelectItem>
                  <SelectItem value="1.25">1.25×</SelectItem>
                  <SelectItem value="1.5">1.5×</SelectItem>
                  <SelectItem value="2">2×</SelectItem>
                </SelectContent>
              </Select>

              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
              >
                {isFullscreen ? (
                  <Minimize2 size={13} />
                ) : (
                  <Maximize2 size={13} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
