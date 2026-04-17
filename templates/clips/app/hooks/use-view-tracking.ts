import { useEffect, useRef } from "react";

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

export interface UseViewTrackingOpts {
  recordingId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  durationMs: number;
  /** Disable tracking entirely (e.g. for the recording's owner viewing their own clip). */
  disabled?: boolean;
}

/**
 * Wires up the view-event tracker for a player instance. Fires a "view-start"
 * on mount, then throttled "watch-progress" every 5s while playing, plus
 * seek/pause/resume events and a final flush on unmount.
 */
export function useViewTracking(opts: UseViewTrackingOpts) {
  const { recordingId, videoRef, durationMs, disabled } = opts;
  const watchMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const lastSentProgressRef = useRef(0);
  const maxPctRef = useRef(0);

  useEffect(() => {
    if (disabled) return;
    const video = videoRef.current;
    if (!video) return;

    const sessionId = getSessionId();
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
      const v = videoRef.current;
      if (!v) return;
      const completedPct =
        durationMs > 0 ? (watchMsRef.current / durationMs) * 100 : 0;
      maxPctRef.current = Math.max(maxPctRef.current, completedPct);
      fetch("/api/view-event", {
        method: "POST",
        keepalive: kind === "watch-progress" || kind === "pause",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId,
          kind,
          timestampMs: Math.floor(v.currentTime * 1000),
          sessionId,
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

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("ended", onEnded);
      if (progressTimer) clearInterval(progressTimer);
      // Flush final progress.
      if (startedRef.current) post("watch-progress");
    };
  }, [recordingId, videoRef, durationMs, disabled]);

  return {
    reportCtaClick: () => {
      fetch("/api/view-event", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId,
          kind: "cta-click",
          sessionId: getSessionId(),
        }),
      }).catch(() => {});
    },
    reportReaction: (emoji: string) => {
      fetch("/api/view-event", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId,
          kind: "reaction",
          sessionId: getSessionId(),
          payload: { emoji },
        }),
      }).catch(() => {});
    },
  };
}
