import type {
  ClipCommentMarker,
  ClipPlayback,
} from "@shared/clips-peer-contract";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { mediaPlace, swapMediaSource, type MediaState } from "./clip-media";
import { PlayerControls } from "./player-controls";

/** A Clip's video with Clips' controls docked under it. */
export function ClipPlayer({
  grant,
  markers,
  onMediaError,
  resumeRef,
}: {
  grant: ClipPlayback;
  markers: ClipCommentMarker[];
  onMediaError: () => void;
  /** Where the reader was when an earlier player of this Clip went away,
   *  such as behind an outage; the next player starts there. */
  resumeRef?: MutableRefObject<MediaState | null>;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const src = grant.playback.videoUrl;
  const { width, height } = grant.recording;
  const aspectRatio = width && height ? width / height : 16 / 9;
  // A recording made in the browser often reports no length until it has
  // played through, so Clips' stored length stands in.
  const durationMs = mediaDurationMs ?? grant.recording.durationMs ?? 0;

  // React never owns `src`: a new grant moves the playing video over with
  // its time, play state, volume and rate instead of reloading it.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (!video.getAttribute("src")) {
      const place = resumeRef?.current;
      if (resumeRef && place) {
        resumeRef.current = null;
        swapMediaSource(video, src, place);
      } else {
        video.src = src;
      }
      return;
    }
    if (video.src !== src) swapMediaSource(video, src);
  }, [resumeRef, src]);

  // Read before React removes the element, which pauses it.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !resumeRef) return;
    return () => {
      resumeRef.current = mediaPlace(video);
    };
  }, [resumeRef]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const video = () => videoRef.current;
  const seek = (ms: number) => {
    const element = video();
    if (!element) return;
    element.currentTime = Math.max(0, ms / 1000);
    setCurrentMs(element.currentTime * 1000);
  };
  const togglePlay = () => {
    const element = video();
    if (!element) return;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  };

  return (
    <div
      ref={frameRef}
      data-clip-player
      className="overflow-hidden rounded-lg bg-player-control text-left leading-normal"
    >
      <video
        ref={videoRef}
        poster={grant.playback.posterUrl ?? undefined}
        preload="metadata"
        playsInline
        className="block w-full bg-player-control object-contain"
        style={{
          aspectRatio,
          maxHeight: fullscreen ? "calc(100vh - 6rem)" : undefined,
        }}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) =>
          setCurrentMs(event.currentTarget.currentTime * 1000)
        }
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          setMediaDurationMs(Number.isFinite(seconds) ? seconds * 1000 : null);
        }}
        onDurationChange={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds)) setMediaDurationMs(seconds * 1000);
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
        onError={onMediaError}
      />
      <PlayerControls
        isPlaying={playing}
        durationMs={durationMs}
        currentMs={currentMs}
        volume={volume}
        muted={muted}
        speed={speed}
        isFullscreen={fullscreen}
        comments={markers}
        onPlayPause={togglePlay}
        onSeek={seek}
        onSeekRelative={(deltaMs) =>
          seek(Math.min(durationMs || Infinity, currentMs + deltaMs))
        }
        onVolumeChange={(next) => {
          const element = video();
          if (!element) return;
          element.volume = next;
          element.muted = next === 0;
        }}
        onToggleMute={() => {
          const element = video();
          if (element) element.muted = !element.muted;
        }}
        onSpeedChange={(rate) => {
          const element = video();
          if (element) element.playbackRate = rate;
        }}
        onToggleFullscreen={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void frameRef.current?.requestFullscreen?.();
        }}
        menuPortalContainer={fullscreen ? frameRef.current : undefined}
      />
    </div>
  );
}
