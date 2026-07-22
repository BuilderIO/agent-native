import { appBasePath } from "@agent-native/core/client/api-path";
import { useEffect, useRef } from "react";

import { clampCompletionPct } from "../../shared/view-analytics";

const SESSION_KEY = "clips-view-session-id";

function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        "s-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 8);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "s-" + Math.random().toString(36).slice(2, 8);
  }
}

function createViewSessionId(recordingId: string): string {
  return [
    "v",
    recordingId,
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join("-");
}

export interface UseViewTrackingOpts {
  recordingId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  durationMs: number;
  /** Disable tracking entirely (e.g. for the recording's owner viewing their own clip). */
  disabled?: boolean;
  /** Count an open as a view when playback is iframe-backed and there is no native video element. */
  trackOpenWithoutVideo?: boolean;
}

/**
 * Wires up the view-event tracker for a player instance. Fires a "view-start"
 * on mount, then throttled "watch-progress" every 5s while playing, plus
 * seek/pause/resume events and a final flush on unmount.
 *
 * Runs on every render (no dependency array) but only re-attaches listeners
 * when the video element, recordingId, or trackOpenWithoutVideo actually
 * change — e.g. an edit-mode toggle unmounts/remounts the player, or a
 * route reuses the same player instance for a different recording. Reading
 * the latest opts through a ref keeps long-lived listener closures (which
 * may outlive several renders) from ever using stale values like
 * `durationMs`.
 */
export function useViewTracking(opts: UseViewTrackingOpts) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const watchMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const openTrackedRecordingRef = useRef<string | null>(null);
  const lastSentProgressRef = useRef(0);
  const maxPctRef = useRef(0);
  const viewSessionRef = useRef<string | null>(null);
  const attachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const attachedRecordingIdRef = useRef<string | null>(null);
  const attachedTrackOpenRef = useRef(false);
  const hasAttachedRef = useRef(false);
  const cleanupRef = useRef<() => void>(() => {});
  const durationMsRef = useRef(opts.durationMs);

  useEffect(() => {
    const {
      recordingId,
      videoRef,
      disabled,
      trackOpenWithoutVideo,
      durationMs,
    } = optsRef.current;

    if (disabled) {
      cleanupRef.current();
      cleanupRef.current = () => {};
      hasAttachedRef.current = true;
      attachedVideoRef.current = null;
      attachedRecordingIdRef.current = recordingId;
      attachedTrackOpenRef.current = !!trackOpenWithoutVideo;
      return;
    }

    const video = videoRef.current;
    const unchanged =
      hasAttachedRef.current &&
      video === attachedVideoRef.current &&
      recordingId === attachedRecordingIdRef.current &&
      !!trackOpenWithoutVideo === attachedTrackOpenRef.current;
    if (unchanged) {
      // Still the same session — keep the duration in sync so an
      // async-loaded duration is reflected without a full reattach. Do
      // this before any potential teardown below so a genuine session
      // change never mutates the ref before the old session's final flush.
      durationMsRef.current = durationMs;
      return;
    }

    // Tear down the previous session's listeners while durationMsRef still
    // holds its duration, so its final flush computes completion correctly.
    cleanupRef.current();
    durationMsRef.current = durationMs;
    hasAttachedRef.current = true;
    attachedVideoRef.current = video;
    attachedRecordingIdRef.current = recordingId;
    attachedTrackOpenRef.current = !!trackOpenWithoutVideo;

    // A different video element, recording, or embed mode starts a fresh
    // tracking session — last session's counters must not carry over.
    watchMsRef.current = 0;
    lastTickRef.current = null;
    startedRef.current = false;
    lastSentProgressRef.current = 0;
    maxPctRef.current = 0;
    viewSessionRef.current = null;

    if (!video) {
      if (
        !trackOpenWithoutVideo ||
        !recordingId ||
        openTrackedRecordingRef.current === recordingId
      ) {
        cleanupRef.current = () => {};
        return;
      }
      openTrackedRecordingRef.current = recordingId;
      viewSessionRef.current = createViewSessionId(recordingId);
      fetch(`${appBasePath()}/api/view-event`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId,
          kind: "view-start",
          timestampMs: 0,
          sessionId: getSessionId(),
          viewSessionId: viewSessionRef.current,
          totalWatchMs: 0,
          completedPct: 0,
          scrubbedToEnd: false,
          payload: { source: "iframe-open" },
        }),
      }).catch(() => {});
      cleanupRef.current = () => {};
      return;
    }

    const sessionId = getSessionId();
    viewSessionRef.current = createViewSessionId(recordingId);
    let progressTimer: ReturnType<typeof setInterval> | null = null;

    function post(
      kind:
        | "view-start"
        | "watch-progress"
        | "seek"
        | "pause"
        | "resume"
        | "cta-click"
        | "reaction",
      extra?: Record<string, unknown>,
    ) {
      const { videoRef } = optsRef.current;
      const v = videoRef.current;
      if (!v) return;
      const durationMs = durationMsRef.current;
      const completedPct =
        durationMs > 0 ? (watchMsRef.current / durationMs) * 100 : 0;
      maxPctRef.current = Math.max(
        maxPctRef.current,
        clampCompletionPct(completedPct),
      );
      fetch(`${appBasePath()}/api/view-event`, {
        method: "POST",
        keepalive: kind === "watch-progress" || kind === "pause",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId,
          kind,
          timestampMs: Math.floor(v.currentTime * 1000),
          sessionId,
          viewSessionId: viewSessionRef.current,
          totalWatchMs: Math.floor(watchMsRef.current),
          completedPct: Math.floor(maxPctRef.current),
          scrubbedToEnd: v.duration > 0 && v.currentTime >= v.duration - 0.5,
          payload: extra,
        }),
      }).catch(() => {});
    }

    function onPlay() {
      if (!startedRef.current) {
        startedRef.current = true;
        post("view-start");
      } else {
        post("resume");
      }
      lastTickRef.current = performance.now();
      // Heartbeat every 5s while playing.
      progressTimer = setInterval(() => {
        const now = performance.now();
        if (lastTickRef.current != null) {
          const delta = Math.max(0, now - lastTickRef.current);
          watchMsRef.current += delta;
          lastTickRef.current = now;
        }
        // Throttle by sent delta so we don't overwhelm the server.
        if (watchMsRef.current - lastSentProgressRef.current >= 4000) {
          lastSentProgressRef.current = watchMsRef.current;
          post("watch-progress");
        }
      }, 1000);
    }

    function onPause() {
      if (lastTickRef.current != null) {
        watchMsRef.current += performance.now() - lastTickRef.current;
        lastTickRef.current = null;
      }
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      post("pause");
    }

    function onSeek() {
      post("seek");
    }

    function onEnded() {
      post("watch-progress");
    }

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeek);
    video.addEventListener("ended", onEnded);

    cleanupRef.current = () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("ended", onEnded);
      if (progressTimer) clearInterval(progressTimer);
      // Flush final progress.
      if (startedRef.current) post("watch-progress");
    };
  });

  useEffect(() => {
    return () => {
      cleanupRef.current();
      cleanupRef.current = () => {};
      // Reset attachment identity so a StrictMode dev remount (or any real
      // remount that reuses the same video/recording) re-attaches instead
      // of seeing "unchanged" and silently skipping setup. Also reset the
      // iframe-open dedup guard so a later reopen of the same no-video
      // (e.g. Loom-backed) recording fires its view-start again.
      hasAttachedRef.current = false;
      attachedVideoRef.current = null;
      attachedRecordingIdRef.current = null;
      attachedTrackOpenRef.current = false;
      openTrackedRecordingRef.current = null;
    };
  }, []);

  return {
    reportCtaClick: () => {
      fetch(`${appBasePath()}/api/view-event`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: optsRef.current.recordingId,
          kind: "cta-click",
          sessionId: getSessionId(),
        }),
      }).catch(() => {});
    },
    reportReaction: (emoji: string) => {
      fetch(`${appBasePath()}/api/view-event`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: optsRef.current.recordingId,
          kind: "reaction",
          sessionId: getSessionId(),
          payload: { emoji },
        }),
      }).catch(() => {});
    },
  };
}
