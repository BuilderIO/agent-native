import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Draggable, circular camera bubble. Grabs its own webcam stream so the
 * popover doesn't have to pipe video frames across Tauri windows. The popover
 * emits `clips:bubble-config` with the chosen deviceId.
 *
 * Why the bubble turns black during recording on macOS (and how we recover):
 *
 * All Tauri webviews in one app share a single WebKit process and a single
 * media-session arbiter. When the popover calls `getDisplayMedia()` and
 * `getUserMedia({audio})` to start recording, WebKit briefly renegotiates
 * the whole capture graph in that process. The bubble's camera track
 * DOESN'T always end — WebKit often just flips it to `muted` (frames stop
 * arriving, readyState stays "live"). The `<video>` element happily reports
 * `paused=false` and renders a solid black frame from the last muted track.
 *
 * Recovery strategy:
 *   1. Listen for `onmute` in addition to `onended` — `onmute` is the
 *      common case for intra-process capture collisions on macOS WebKit.
 *      When it fires we tear down and re-acquire (`onunmute` by itself
 *      does NOT bring the frame pump back for these muted tracks).
 *   2. Watchdog: poll once a second. If the active track is `muted` OR
 *      the <video> has `readyState < 2` while we think we have a stream,
 *      force a restart.
 *   3. Also listen for `clips:recording-started` — emitted by the
 *      recorder driver right after MediaRecorder.start() — and schedule
 *      a refresh ~600ms later. That's the known hot-spot where the media
 *      session renegotiates; proactively reacquiring is faster than
 *      waiting for the watchdog to notice a black frame.
 *   4. Track the live stream on a ref so cleanup ALWAYS stops the old
 *      tracks before a new getUserMedia runs. Letting them linger keeps
 *      the camera "busy" as far as macOS is concerned and the new stream
 *      comes back black.
 *   5. Ignore redundant bubble-config emits with the same deviceId to
 *      avoid gratuitous cleanup→restart churn.
 */
export function Bubble() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const restartRef = useRef<(reason: string) => void>(() => {});
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<{ deviceId?: string }>("clips:bubble-config", (ev) => {
      const next = ev.payload.deviceId;
      console.log("[bubble] bubble-config event", { deviceId: next });
      if (!next) return;
      setDeviceId((prev) => (prev === next ? prev : next));
    }).then((u) => unlistens.push(u));
    // The popover emits this after MediaRecorder.start() — the known hot
    // spot where WKWebView tends to mute our camera track. Proactively
    // reacquire ~600ms later so we're back to live frames before the user
    // has a chance to notice the black circle.
    listen("clips:recording-started", () => {
      console.log(
        "[bubble] recording-started received; scheduling refresh in 600ms",
      );
      setTimeout(() => restartRef.current("recording-started"), 600);
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
      console.log("[bubble] stopping previous stream before getUserMedia");
      prev.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }

    async function start() {
      try {
        console.log("[bubble] getUserMedia requested", { deviceId });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const vtrack = stream.getVideoTracks()[0];
        console.log("[bubble] getUserMedia resolved", {
          deviceId,
          label: vtrack?.label,
          readyState: vtrack?.readyState,
          muted: vtrack?.muted,
          settings: vtrack?.getSettings?.(),
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch((e) => {
            console.log("[bubble] video.play() rejected", e);
          });
          console.log("[bubble] video bound", {
            paused: videoRef.current.paused,
            readyState: videoRef.current.readyState,
          });
        }
        // Safety net: if a track ends OR gets muted by the system (WebKit
        // does this when another webview in the same process starts a
        // capture), re-acquire so the bubble recovers instead of staying
        // frozen on a dead/black frame.
        stream.getVideoTracks().forEach((t) => {
          t.onended = () => {
            console.log("[bubble] track onended — restarting");
            if (cancelled) return;
            restartRef.current("track-ended");
          };
          t.onmute = () => {
            console.log("[bubble] track onmute — restarting");
            if (cancelled) return;
            restartRef.current("track-muted");
          };
          t.onunmute = () => {
            console.log("[bubble] track onunmute");
          };
        });
      } catch (err) {
        console.error("[bubble] getUserMedia failed", err);
        setError(err instanceof Error ? err.message : "Camera unavailable");
      }
    }

    let restarting = false;
    async function restart(reason: string) {
      if (cancelled || restarting) return;
      restarting = true;
      console.log("[bubble] restart()", { reason });
      const current = streamRef.current;
      if (current) {
        current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      await start();
      restarting = false;
    }
    restartRef.current = (reason: string) => {
      void restart(reason);
    };

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

  // Watchdog: every second, check the track + <video> state. If the track
  // went `muted` without firing onmute, or the video is stuck with no
  // decoded frames (readyState < 2) while we think we have a live stream,
  // force a restart. Belt-and-suspenders for the WebKit mute case.
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const v = videoRef.current;
      const s = streamRef.current;
      const track = s?.getVideoTracks()[0];
      if (v && v.srcObject && v.paused && !v.ended) {
        v.play().catch(() => {});
      }
      if (track) {
        // Keep this log cheap but visible — the watchdog prints once a
        // second and is the single most useful signal when debugging
        // "why is the bubble black?" reports.
        console.log("[bubble] watchdog", {
          trackReadyState: track.readyState,
          trackMuted: track.muted,
          videoPaused: v?.paused,
          videoReadyState: v?.readyState,
        });
        if (
          track.muted ||
          track.readyState === "ended" ||
          (v && v.readyState < 2 && !v.paused)
        ) {
          console.log("[bubble] watchdog sees dead stream — restarting");
          restartRef.current("watchdog");
        }
      }
    };
    const iv = setInterval(tick, 1000);
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
