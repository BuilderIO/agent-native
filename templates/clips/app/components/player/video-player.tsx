import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { PlayerControls } from "./player-controls";
import { CaptionsOverlay } from "./captions-overlay";
import { CtaButton } from "./cta-button";

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
    } = props;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(startMs ?? 0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [speed, setSpeed] = useState(defaultSpeed);
    const [showControls, setShowControls] = useState(true);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPip, setIsPip] = useState(false);

    // Imperative handle for parent
    useImperativeHandle(
      ref,
      () => ({
        get video() {
          return videoRef.current;
        },
        play: () => videoRef.current?.play(),
        pause: () => videoRef.current?.pause(),
        seek: (ms: number) => {
          if (videoRef.current) {
            videoRef.current.currentTime = ms / 1000;
            setCurrentMs(ms);
            onSeek?.(ms);
          }
        },
        setSpeed: (rate: number) => {
          if (videoRef.current) videoRef.current.playbackRate = rate;
          setSpeed(rate);
        },
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
      [onSeek],
    );

    // Apply initial playbackRate and start position.
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      v.playbackRate = defaultSpeed;
      setSpeed(defaultSpeed);
      if (startMs && startMs > 0) {
        v.currentTime = startMs / 1000;
        setCurrentMs(startMs);
      }
    }, [defaultSpeed, startMs, videoUrl]);

    // Hide controls after 2s of idle movement.
    const bumpControls = useCallback(() => {
      setShowControls(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (alwaysShowControls) return;
      idleTimer.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    }, [alwaysShowControls]);

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
      durationMs > 0 &&
      currentMs >= durationMs - 200;

    const showThroughoutCta = cta && cta.placement === "throughout";

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
          if (videoRef.current) {
            if (videoRef.current.paused) videoRef.current.play();
            else videoRef.current.pause();
          }
        }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            poster={thumbnailUrl ?? undefined}
            className={cn(
              "w-full h-full",
              cover ? "object-cover" : "object-contain",
            )}
            autoPlay={autoPlay}
            playsInline
            onPlay={() => {
              setIsPlaying(true);
              onPlay?.();
            }}
            onPause={() => {
              setIsPlaying(false);
              onPause?.();
            }}
            onTimeUpdate={(e) => {
              const ms = Math.floor(e.currentTarget.currentTime * 1000);
              setCurrentMs(ms);
              onTimeUpdate?.(ms, durationMs);
            }}
            onEnded={() => {
              setIsPlaying(false);
              onEnded?.();
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
              durationMs={durationMs}
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
              hasCaptions={!!transcriptSegments?.length}
              onPlayPause={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) v.play();
                else v.pause();
              }}
              onSeek={(ms) => {
                const v = videoRef.current;
                if (v) {
                  v.currentTime = ms / 1000;
                  setCurrentMs(ms);
                  onSeek?.(ms);
                }
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
                const v = videoRef.current;
                if (v) v.playbackRate = rate;
                setSpeed(rate);
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
