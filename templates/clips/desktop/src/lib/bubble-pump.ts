/**
 * JPEG frame pump for the camera bubble overlay.
 *
 * Owned by the popover (see `recorder.ts` top-of-file comment for the
 * WebKit capture-exclusion rationale — the popover is the only page that
 * can hold the camera, so it's also the page that emits frames to the
 * bubble overlay window). The pump reads from a given `MediaStream`, draws
 * each frame into an offscreen canvas, encodes JPEG, and emits
 * `clips:bubble-frame` events over Tauri IPC.
 *
 * The pump runs for the FULL camera session — pre-record preview AND
 * recording. The recorder does NOT start its own pump; it only consumes
 * the video track via MediaRecorder. That way a single pump instance
 * survives the preview → recording transition without any frame-drop
 * handoff, which was the source of the "bubble goes black when recording
 * starts" bug.
 *
 * Returns a stop fn that cancels the scheduler and releases the hidden
 * video + canvas elements. The caller owns the MediaStream lifecycle.
 *
 * ## Performance notes (updates-121)
 *
 * Previous versions ran at 10 FPS / 144px during recording and STILL
 * dropped frames to single-digits because the popover's main thread is
 * saturated during recording: MediaRecorder encoding video + audio +
 * continuous chunk `fetch()` uploads to localhost + Tauri IPC emit +
 * canvas.drawImage + canvas.toDataURL + getDisplayMedia + getUserMedia
 * stream internals. The pump competes with all of that for the one JS
 * main thread the webview has.
 *
 * Web research findings (April 2026, WKWebView on macOS):
 * - OffscreenCanvas + transferControlToOffscreen in a Worker is only
 *   reliable for WebGL contexts on Safari 17+; the 2D context path in
 *   a Worker has been historically unreliable in WebKit (three.js issue
 *   16782, Safari Tech Preview thread 704724). Risky for production.
 * - MediaStreamTrackProcessor is Tech Preview in Safari 18+, and only
 *   fully shipped in Safari 26+. Can't rely on it.
 * - createImageBitmap from a <video> element is documented-slow on
 *   Safari (WebKit bug 234920 — "ImageBitmap created from a video
 *   element has poor performance"). Avoid.
 * - HTMLImageElement.decode() is well-supported on Safari since ~15
 *   and decodes off the main thread. This is the fast receive path.
 *
 * So we picked the defensible combination:
 *
 * 1. **Recording relay kept readable** — full-screen capture now uses the
 *    bubble's local camera path, but window capture can still need this
 *    fallback. Keep recording frames at retina-small-bubble resolution so the
 *    user's face does not turn blocky.
 * 2. **Chunk-upload yielding** (new) — the recorder sets
 *    `window.clipsChunkBusy = true` while a chunk upload is in flight;
 *    the pump skips ticks while that flag is set. With MediaRecorder
 *    configured for ~1s chunks, this means the pump gets a clear
 *    ~150-300ms slice of main thread each second where it CAN'T
 *    possibly be competing with the chunk POST.
 * 3. **Async image decode with yielding** (Option C adapted) — we
 *    still use canvas.drawImage + canvas.toDataURL (the WebKit-fast
 *    path — no blob round-trip, no bitmap creation from a video), but
 *    we trigger the encode inside a `queueMicrotask` so the rVFC
 *    callback returns quickly, letting the compositor render a frame
 *    before we synchronously block the thread on toDataURL.
 * 4. **Frame-time budget guard** — if the PREVIOUS encode took longer
 *    than the per-frame budget, skip the next tick outright. Prevents
 *    the pump from falling into a "I'm always running" mode when the
 *    main thread is overloaded; instead it gracefully drops to
 *    whatever framerate the system can actually sustain.
 * 5. **Receiver image pool** (Option D) — see `bubble.tsx`. We swap
 *    between two `<img>` elements so the previous decode can complete
 *    without being cancelled by the incoming frame, preserving the
 *    useful work the decode pipeline did.
 *
 * Fallbacks: all new signals (`window.clipsChunkBusy`, rVFC,
 * OffscreenCanvas) feature-detect and degrade to the previous path if
 * absent. The pump MUST keep producing frames even if every optimistic
 * path fails; the user should never see a black bubble.
 */
import { emit } from "@tauri-apps/api/event";

const BUBBLE_PREVIEW_FPS = 15;
const BUBBLE_RECORDING_FPS = 12;
const BUBBLE_PREVIEW_FRAME_INTERVAL_MS = Math.round(1000 / BUBBLE_PREVIEW_FPS);
const BUBBLE_RECORDING_FRAME_INTERVAL_MS = Math.round(
  1000 / BUBBLE_RECORDING_FPS,
);
const BUBBLE_PREVIEW_FRAME_SIZE = 192;
const BUBBLE_RECORDING_FRAME_SIZE = 192;
const BUBBLE_PREVIEW_JPEG_QUALITY = 0.6;
const BUBBLE_RECORDING_JPEG_QUALITY = 0.72;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function startBubbleFramePump(stream: MediaStream): () => void {
  const video = document.createElement("video") as VideoWithRvfc;
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  video.play().catch((err) => {
    console.warn("[clips-bubble-pump] video.play() rejected", err);
  });

  const canvas = document.createElement("canvas");
  canvas.width = BUBBLE_PREVIEW_FRAME_SIZE;
  canvas.height = BUBBLE_PREVIEW_FRAME_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  const hasRvfc = typeof video.requestVideoFrameCallback === "function";
  console.log(
    `[clips-bubble-pump] started preview=${BUBBLE_PREVIEW_FPS}fps@${BUBBLE_PREVIEW_FRAME_SIZE}px record=${BUBBLE_RECORDING_FPS}fps@${BUBBLE_RECORDING_FRAME_SIZE}px rvfc=${hasRvfc}`,
  );

  let busy = false;
  let stopped = false;
  let lastEmitMs = 0;
  let lastEncodeDurationMs = 0;
  let rafHandle: number | null = null;
  let rvfcHandle: number | null = null;

  const heartbeat = setInterval(() => {
    if (stopped) return;
    if (video.paused) {
      video.play().catch(() => {
        // ignore — next tick will try again
      });
    }
  }, 2000);

  function encodeAndEmit(): void {
    if (!ctx || busy || stopped) return;
    const w = window as unknown as {
      clipsForceAlive?: boolean;
      clipsChunkBusy?: boolean;
    };
    const forceAlive = w.clipsForceAlive === true;
    if (document.hidden && !forceAlive) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const recording = forceAlive;
    const frameSize = recording
      ? BUBBLE_RECORDING_FRAME_SIZE
      : BUBBLE_PREVIEW_FRAME_SIZE;
    const frameIntervalMs = recording
      ? BUBBLE_RECORDING_FRAME_INTERVAL_MS
      : BUBBLE_PREVIEW_FRAME_INTERVAL_MS;
    const quality = recording
      ? BUBBLE_RECORDING_JPEG_QUALITY
      : BUBBLE_PREVIEW_JPEG_QUALITY;

    const now = performance.now();
    if (now - lastEmitMs < frameIntervalMs) return;

    if (recording && w.clipsChunkBusy === true) return;

    // main thread a real break. Trailing-edge only — the next tick re-
    if (lastEncodeDurationMs > frameIntervalMs) {
      lastEncodeDurationMs = 0;
      lastEmitMs = now;
      return;
    }

    lastEmitMs = now;

    if (canvas.width !== frameSize) canvas.width = frameSize;
    if (canvas.height !== frameSize) canvas.height = frameSize;

    busy = true;
    const encodeStart = performance.now();
    queueMicrotask(() => {
      if (stopped) {
        busy = false;
        return;
      }
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const side = Math.min(vw, vh);
        const sx = (vw - side) / 2;
        const sy = (vh - side) / 2;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, frameSize, frameSize);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (stopped) return;
        emit("clips:bubble-frame", {
          dataUrl,
          w: frameSize,
          h: frameSize,
        }).catch(() => {});
      } catch (err) {
        console.warn("[clips-bubble-pump] tick failed", err);
      } finally {
        lastEncodeDurationMs = performance.now() - encodeStart;
        busy = false;
      }
    });
  }

  function rafLoop(): void {
    if (stopped) return;
    rafHandle = requestAnimationFrame(() => {
      encodeAndEmit();
      rafLoop();
    });
  }

  function rvfcLoop(): void {
    if (stopped || !video.requestVideoFrameCallback) return;
    rvfcHandle = video.requestVideoFrameCallback(() => {
      encodeAndEmit();
      rvfcLoop();
    });
  }

  if (hasRvfc) {
    rvfcLoop();
  } else {
    rafLoop();
  }

  return () => {
    stopped = true;
    clearInterval(heartbeat);
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (rvfcHandle !== null && video.cancelVideoFrameCallback) {
      try {
        video.cancelVideoFrameCallback(rvfcHandle);
      } catch {
        // ignore — some webviews throw if the handle already fired
      }
      rvfcHandle = null;
    }
    try {
      video.pause();
    } catch {
      // ignore
    }
    video.srcObject = null;
    video.remove();
    console.log("[clips-bubble-pump] stopped");
  };
}
