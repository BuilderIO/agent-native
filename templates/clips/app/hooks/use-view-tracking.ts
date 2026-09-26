import { appBasePath } from "@agent-native/core/client/api-path";
import { useEffect, useRef } from "react";

import { getViewerSessionId } from "@/lib/viewer-session";

import { clampCompletionPct } from "../../shared/view-analytics";

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
  videoEl: HTMLVideoElement | null;
  durationMs: number;
  disabled?: boolean;
  trackOpenWithoutVideo?: boolean;
}

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
          sessionId: getViewerSessionId(),
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
    const sessionId = getViewerSessionId();
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
      progressTimer = setInterval(() => {
        const now = performance.now();
        if (lastTickRef.current != null) {
          const delta = Math.max(0, now - lastTickRef.current);
          watchMsRef.current += delta;
          lastTickRef.current = now;
        }
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
          sessionId: getViewerSessionId(),
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
          sessionId: getViewerSessionId(),
          payload: { emoji },
        }),
      }).catch(() => {});
    },
  };
}
