import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { agentNativePath } from "@agent-native/core/client";

export interface Bounds {
  startMs: number;
  endMs: number;
}

export interface UseCallPlayerOptions {
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  durationMs: number;
  boundsMs?: Bounds;
  defaultSpeed?: number;
  callId?: string;
}

export interface CallPlayerState {
  currentMs: number;
  playing: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  captionsOn: boolean;
  seek: (ms: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (rate: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  skip: (deltaMs: number) => void;
  stepFrame: (dir: 1 | -1) => void;
}

const FRAME_MS = 1000 / 30;

function writeClientAppState(key: string, value: unknown) {
  return fetch(
    agentNativePath(`/_agent-native/application-state/${encodeURIComponent(key)}`),
    {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
    },
  );
}

export function useCallPlayer(options: UseCallPlayerOptions): CallPlayerState {
  const { mediaRef, durationMs, boundsMs, defaultSpeed, callId } = options;

  const [currentMs, setCurrentMs] = useState(boundsMs?.startMs ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(defaultSpeed ?? 1);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);

  const clamp = useCallback(
    (ms: number) => {
      const min = boundsMs?.startMs ?? 0;
      const max = boundsMs?.endMs ?? durationMs ?? ms;
      if (max <= 0) return Math.max(0, ms);
      return Math.max(min, Math.min(max, ms));
    },
    [boundsMs?.startMs, boundsMs?.endMs, durationMs],
  );

  const seek = useCallback(
    (ms: number) => {
      const el = mediaRef.current;
      const target = clamp(ms);
      if (el) el.currentTime = target / 1000;
      setCurrentMs(target);
    },
    [mediaRef, clamp],
  );

  const play = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (boundsMs && el.currentTime * 1000 >= boundsMs.endMs - 50) {
      el.currentTime = boundsMs.startMs / 1000;
    }
    void el.play();
  }, [mediaRef, boundsMs]);

  const pause = useCallback(() => {
    mediaRef.current?.pause();
  }, [mediaRef]);

  const toggle = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, [mediaRef]);

  const setSpeed = useCallback(
    (rate: number) => {
      const el = mediaRef.current;
      if (el) el.playbackRate = rate;
      setSpeedState(rate);
    },
    [mediaRef],
  );

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      const el = mediaRef.current;
      if (el) {
        el.volume = clamped;
        el.muted = clamped === 0;
      }
      setVolumeState(clamped);
      setMuted(clamped === 0);
    },
    [mediaRef],
  );

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, [mediaRef]);

  const toggleCaptions = useCallback(() => {
    setCaptionsOn((v) => !v);
  }, []);

  const skip = useCallback(
    (deltaMs: number) => {
      const el = mediaRef.current;
      if (!el) return;
      const nextMs = clamp(el.currentTime * 1000 + deltaMs);
      el.currentTime = nextMs / 1000;
      setCurrentMs(nextMs);
    },
    [mediaRef, clamp],
  );

  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      const el = mediaRef.current;
      if (!el) return;
      if (!el.paused) el.pause();
      const nextMs = clamp(el.currentTime * 1000 + dir * FRAME_MS);
      el.currentTime = nextMs / 1000;
      setCurrentMs(nextMs);
    },
    [mediaRef, clamp],
  );

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (defaultSpeed) {
      el.playbackRate = defaultSpeed;
      setSpeedState(defaultSpeed);
    }
  }, [mediaRef, defaultSpeed]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      const ms = Math.floor(el.currentTime * 1000);
      setCurrentMs(ms);
      if (boundsMs && ms >= boundsMs.endMs) {
        el.pause();
        el.currentTime = boundsMs.endMs / 1000;
      }
    };
    const onRate = () => setSpeedState(el.playbackRate);
    const onVolume = () => {
      setVolumeState(el.volume);
      setMuted(el.muted);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("ratechange", onRate);
    el.addEventListener("volumechange", onVolume);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("ratechange", onRate);
      el.removeEventListener("volumechange", onVolume);
    };
  }, [mediaRef, boundsMs?.endMs]);

  const lastWriteRef = useRef({ ts: 0, playing: false, mode: "" });
  useEffect(() => {
    const now = Date.now();
    const mode = `${playing}|${Math.round(currentMs / 500)}|${speed}`;
    const shouldWrite =
      lastWriteRef.current.playing !== playing ||
      lastWriteRef.current.mode !== mode ||
      now - lastWriteRef.current.ts > 500;
    if (!shouldWrite) return;
    lastWriteRef.current = { ts: now, playing, mode };
    writeClientAppState("player-state", {
      callId: callId ?? null,
      currentMs,
      durationMs,
      playing,
      speed,
      muted,
      volume,
      captionsOn,
    }).catch(() => {});
  }, [
    callId,
    currentMs,
    durationMs,
    playing,
    speed,
    muted,
    volume,
    captionsOn,
  ]);

  return {
    currentMs,
    playing,
    speed,
    volume,
    muted,
    captionsOn,
    seek,
    play,
    pause,
    toggle,
    setSpeed,
    setVolume,
    toggleMute,
    toggleCaptions,
    skip,
    stepFrame,
  };
}
