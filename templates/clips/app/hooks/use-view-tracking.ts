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
  /**
   * The live `<video>` DOM node, or `null` when there is none (e.g. a Loom
   * iframe embed). Pass the actual element — not a ref wrapper — so this
   * hook's effect can depend on it directly and React's own dependency
   * comparison decides when to reattach, instead of hand-rolled identity
   * bookkeeping.
   */
  videoEl: HTMLVideoElement | null;
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
 * The effect depends on `[recordingId, videoEl, trackOpenWithoutVideo,
 * disabled]`, so React naturally creates a fresh closure — and runs the
 * previous one's cleanup — exactly when any of those actually change (a
 * different video element, a different recording, or the no-video/embed
 * mode flipping). Each closure captures its own `recordingId` and `videoEl`,
 * so a cleanup's final flush always describes the session it belonged to,
 * never a session that has since replaced it.
 *
 * `durationMs` is intentionally excluded from the dependency array — it can
 * load asynchronously after the video/recording is already attached, and
 * reattaching just for that would be wasted work. It's kept in a ref that's
 * synced every render and read fresh inside `post()`.
 */
export function useViewTracking(opts: UseViewTrackingOpts) {
  const { recordingId, videoEl, durationMs, disabled, trackOpenWithoutVideo } =
    opts;

  const watchMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const openTrackedRecordingRef = useRef<string | null>(null);
  const lastSentProgressRef = useRef(0);
  const maxPctRef = useRef(0);
  const viewSessionRef = useRef<string | null>(null);
  const durationMsRef = useRef(durationMs);
  const recordingIdRef = useRef(recordingId);

  durationMsRef.current = durationMs;
  recordingIdRef.current = recordingId;

  useEffect(() => {
    if (disabled) return;

    // Reset per-session counters — this effect only reruns when the video
    // element, recording, or embed mode actually change.
    watchMsRef.current = 0;
    lastTickRef.current = null;
    startedRef.current = false;
    lastSentProgressRef.current = 0;
    maxPctRef.current = 0;
    viewSessionRef.current = null;

    if (!videoEl) {
      if (
        !trackOpenWithoutVideo ||
        !recordingId ||
        openTrackedRecordingRef.current === recordingId
      ) {
        return;
      }
      // Persists for the hook's lifetime (never reset on cleanup): this is
      // what stops a React StrictMode dev mount->cleanup->remount cycle
      // from double-posting the same iframe-open view-start, since — unlike
      // the with-video path below — there's no native DOM event gating it.
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
      return;
    }

    const video = videoEl;
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
          timestampMs: Math.floor(video.currentTime * 1000),
          sessionId,
          viewSessionId: viewSessionRef.current,
          totalWatchMs: Math.floor(watchMsRef.current),
          completedPct: Math.floor(maxPctRef.current),
          scrubbedToEnd:
            video.duration > 0 && video.currentTime >= video.duration - 0.5,
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
      // Flush final progress, still scoped to this closure's own video and
      // recordingId — never one a later render has since moved on to.
      if (startedRef.current) post("watch-progress");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- durationMs is
    // deliberately excluded; it's read live from durationMsRef inside post().
  }, [recordingId, videoEl, trackOpenWithoutVideo, disabled]);

  return {
    reportCtaClick: () => {
      fetch(`${appBasePath()}/api/view-event`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: recordingIdRef.current,
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
          recordingId: recordingIdRef.current,
          kind: "reaction",
          sessionId: getSessionId(),
          payload: { emoji },
        }),
      }).catch(() => {});
    },
  };
}
