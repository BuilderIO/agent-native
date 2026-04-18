import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Draggable, circular camera bubble. Grabs its own webcam stream so the
 * popover doesn't have to pipe video frames across Tauri windows. The popover
 * emits `clips:bubble-config` with the chosen deviceId.
 *
 * NOTE on WebKit quirks: the bubble lives in a Tauri window built with
 * `focused: false`, so macOS WebKit will happily suspend the video element
 * if it believes the stream is no longer active (e.g. after a track ends or
 * a camera hand-off). We mitigate that by:
 *   1. Tracking the live stream on a ref so the cleanup ALWAYS stops it
 *      before a new getUserMedia runs — otherwise the old tracks linger,
 *      macOS keeps the camera busy, and the new stream comes back black.
 *   2. Re-binding srcObject and calling play() whenever a new stream lands
 *      AND on the first rAF after recording starts (the MediaRecorder
 *      startup on the popover side briefly renegotiates camera access and
 *      can leave our <video> in a paused state).
 *   3. Ignoring redundant bubble-config emits with the same deviceId (the
 *      popover fires two of them back-to-back around recording start and
 *      the cleanup→restart churn is what turned the bubble black before).
 */
export function Bubble() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<{ deviceId?: string }>("clips:bubble-config", (ev) => {
      const next = ev.payload.deviceId;
      if (!next) return;
      setDeviceId((prev) => (prev === next ? prev : next));
    }).then((u) => unlistens.push(u));
    return () => unlistens.forEach((u) => u());
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Stop any previous stream BEFORE issuing a new getUserMedia — on macOS
    // the camera is effectively single-owner per process, and letting the
    // old tracks hang on while a new session is requested is what made the
    // bubble come back black right when MediaRecorder started.
    const prev = streamRef.current;
    if (prev) {
      prev.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        // Safety net: if a track ends unexpectedly (camera handed off by
        // another app / process), re-request so the bubble recovers
        // instead of staying frozen on a dead frame.
        stream.getVideoTracks().forEach((t) => {
          t.onended = () => {
            if (cancelled) return;
            // Bump state by setting to the same value object to trigger
            // the effect via React's equality check — we can't just
            // reassign to null because the user may have picked a
            // specific deviceId. Instead, run getUserMedia again inline.
            void restart();
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera unavailable");
      }
    }

    async function restart() {
      const current = streamRef.current;
      if (current) {
        current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      await start();
    }

    start();
    return () => {
      cancelled = true;
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [deviceId]);

  // WebKit occasionally leaves the <video> paused when the srcObject is
  // assigned during a moment the window isn't fully composited (we build
  // with `focused: false`). Poll cheaply for the first few seconds and
  // kick it back into play — the tracks are already live, the element
  // just isn't pulling frames.
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.srcObject && v.paused && !v.ended) {
        v.play().catch(() => {});
      }
    };
    const iv = setInterval(tick, 500);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="bubble-root" data-tauri-drag-region>
      {error ? (
        <div className="bubble-error">{error}</div>
      ) : (
        <video
          ref={videoRef}
          className="bubble-video"
          playsInline
          muted
          autoPlay
        />
      )}
    </div>
  );
}
