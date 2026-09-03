import { useEffect, useRef } from "react";

import {
  getPlaybackPosition,
  savePlaybackPosition,
} from "@/lib/playback-position";

const SAVE_INTERVAL_MS = 5_000;
const MIN_POSITION_MS = 50;
const COMPLETION_TAIL_MS = 1_500;

export interface UsePlaybackPositionOptions {
  recordingId: string;
  videoEl: HTMLVideoElement | null;
  durationMs: number;
  enabled?: boolean;
  explicitStartMs?: number;
  allowRestoreWhilePlaying?: boolean;
  onRestore?: (positionMs: number) => void;
}

/**
 * Persists the latest native-video position for the current viewer. This is
 * separate from view analytics so the recording owner can resume without
 * becoming one of the clip's counted viewers.
 */
export function usePlaybackPosition({
  recordingId,
  videoEl,
  durationMs,
  enabled = true,
  explicitStartMs,
  allowRestoreWhilePlaying = false,
  onRestore,
}: UsePlaybackPositionOptions) {
  const durationMsRef = useRef(durationMs);
  const onRestoreRef = useRef(onRestore);

  durationMsRef.current = durationMs;
  onRestoreRef.current = onRestore;

  useEffect(() => {
    if (!enabled || !videoEl || !recordingId) return;

    const controller = new AbortController();
    let cancelled = false;
    let playbackStarted = false;
    let restoreApplied = false;
    let saveInFlight = false;
    let pendingSave: { positionMs: number; keepalive: boolean } | null = null;
    let lastSavedAt = -SAVE_INTERVAL_MS;
    let removePendingRestoreListeners: (() => void) | null = null;

    const readPositionMs = (): number | null => {
      const seconds = videoEl.currentTime;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 1e7) {
        return null;
      }
      return Math.floor(seconds * 1000);
    };

    const persist = (keepalive: boolean) => {
      const positionMs = readPositionMs();
      if (
        positionMs === null ||
        (!playbackStarted && positionMs < MIN_POSITION_MS)
      ) {
        return;
      }

      const now = Date.now();
      if (!keepalive && now - lastSavedAt < SAVE_INTERVAL_MS) {
        return;
      }

      if (saveInFlight) {
        pendingSave = { positionMs, keepalive };
        return;
      }

      saveInFlight = true;
      lastSavedAt = now;
      void savePlaybackPosition(recordingId, positionMs, { keepalive })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[clips] playback position save failed", error);
          }
        })
        .finally(() => {
          saveInFlight = false;
          if (!pendingSave) return;
          const next = pendingSave;
          pendingSave = null;
          persist(next.keepalive);
        });
    };

    const restore = (positionMs: number) => {
      if (cancelled || restoreApplied || explicitStartMs) return;
      if (positionMs <= 0) return;
      const duration = durationMsRef.current;
      if (duration > 0 && positionMs >= duration - COMPLETION_TAIL_MS) {
        return;
      }
      if (
        playbackStarted &&
        !allowRestoreWhilePlaying &&
        readPositionMs() !== 0
      ) {
        return;
      }

      restoreApplied = true;
      onRestoreRef.current?.(positionMs);
    };

    const restoreWhenReady = (positionMs: number) => {
      if (videoEl.readyState >= 1) {
        restore(positionMs);
        return;
      }

      const apply = () => {
        removePendingRestoreListeners?.();
        removePendingRestoreListeners = null;
        restore(positionMs);
      };
      videoEl.addEventListener("loadedmetadata", apply);
      videoEl.addEventListener("loadeddata", apply);
      removePendingRestoreListeners = () => {
        videoEl.removeEventListener("loadedmetadata", apply);
        videoEl.removeEventListener("loadeddata", apply);
      };
    };

    const onPlay = () => {
      playbackStarted = true;
    };
    const onTimeUpdate = () => {
      if (playbackStarted) persist(false);
    };
    const onPause = () => persist(true);
    const onSeeked = () => persist(true);
    const onEnded = () => persist(true);
    const onPageHide = () => persist(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist(true);
    };

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("timeupdate", onTimeUpdate);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.addEventListener("ended", onEnded);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    if (!explicitStartMs) {
      void getPlaybackPosition(recordingId, { signal: controller.signal })
        .then((positionMs) => {
          if (positionMs !== null) restoreWhenReady(positionMs);
        })
        .catch((error) => {
          if (
            !cancelled &&
            (error as { name?: string })?.name !== "AbortError"
          ) {
            console.warn("[clips] playback position load failed", error);
          }
        });
    }

    return () => {
      persist(true);
      cancelled = true;
      controller.abort();
      removePendingRestoreListeners?.();
      removePendingRestoreListeners = null;
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("timeupdate", onTimeUpdate);
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("seeked", onSeeked);
      videoEl.removeEventListener("ended", onEnded);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    allowRestoreWhilePlaying,
    enabled,
    explicitStartMs,
    recordingId,
    videoEl,
  ]);
}
