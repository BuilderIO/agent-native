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
 * Previous version ran at 20 FPS with 256×256 JPEGs at q=0.75 on a raw
 * `setInterval`. During recording the Tauri popover could saturate the
 * main thread (MediaRecorder encoding video + chunked upload + JPEG
 * toBlob) and drop the camera feed framerate. The pump was the biggest
 * avoidable cost.
 *
 * Optimizations applied:
 * - Lowered to 15 FPS preview / 10 FPS recording. The bubble is a small
 *   talking-head PiP; MediaRecorder still captures the composed scene at
 *   30 FPS independently — the pump's job is just to keep the self-view
 *   lively.
 * - Canvas 192 preview / 144 recording → ~44% / ~68% fewer pixels per
 *   frame vs the original 256, and a further 44% drop during recording
 *   specifically when the main thread is already hot with MediaRecorder
 *   encode + chunk upload.
 * - JPEG quality 0.6 preview / 0.55 recording — self-view is forgiving.
 * - **`toDataURL` instead of `toBlob` + `Array.from(Uint8Array)`.** The
 *   previous path encoded JPEG bytes into a ~5–12KB `Uint8Array`, then
 *   `Array.from`'d it into a JS number array, which Tauri then
 *   JSON-stringified for IPC. That was the single hottest main-thread
 *   cost during recording: allocating 5–12k-element arrays at 15 Hz
 *   churns the GC and the JSON serializer blows through the main
 *   thread. `toDataURL` returns a base64 string directly — Tauri can
 *   JSON-stringify a single string in O(bytes) with no array walk. The
 *   bubble side decodes via an `<img>` element (HTML image decode is
 *   off-main-thread in WebKit), drawing once `onload` fires.
 * - `requestAnimationFrame` gating with last-tick throttle so ticks run
 *   when the browser is ready; rAF is paused by WebKit when the tab is
 *   occluded, which gracefully halts work.
 * - `document.hidden` early-out at each tick belt-and-suspenders.
 * - `requestVideoFrameCallback` when available — only encode on a NEW
 *   camera frame, so an idle camera costs ~nothing. Safari/WKWebView has
 *   shipped rVFC (WebKit bug 211945), but we feature-detect and fall back
 *   to a rAF schedule on older webviews.
 * - ImageCapture was considered but is NOT available in WKWebView
 *   (caniuse: 0% Safari), so we stick with the `<video>` + canvas path.
 */
import { emit } from "@tauri-apps/api/event";

/**
 * Preview (pre-record) vs recording tuning. During recording the popover
 * is also running MediaRecorder + chunked fetch uploads on this same main
 * thread, so we downshift everything pump-related to leave headroom.
 * The `window.clipsForceAlive` flag is set by the recording-start path
 * (see `app.tsx`) and serves double duty as our "recording active?"
 * signal — no extra wiring needed.
 *
 * 15 FPS preview / 10 FPS recording:
 * - Preview feels like a live camera.
 * - Recording is a talking-head PiP of yourself; 10 FPS self-view is
 *   plenty and buys us a third of the per-frame encode budget back.
 *
 * 192px preview / 144px recording:
 * - Small bubble is ~96 logical px = 192 physical on retina. Medium is
 *   ~128 logical = 256 physical — slightly oversampled at 192, more at
 *   144, but the bubble circle + mild scaling hides the loss and the
 *   pixel-count win is large.
 */
const BUBBLE_PREVIEW_FPS = 15;
const BUBBLE_RECORDING_FPS = 10;
const BUBBLE_PREVIEW_FRAME_INTERVAL_MS = Math.round(1000 / BUBBLE_PREVIEW_FPS);
const BUBBLE_RECORDING_FRAME_INTERVAL_MS = Math.round(
  1000 / BUBBLE_RECORDING_FPS,
);
const BUBBLE_PREVIEW_FRAME_SIZE = 192;
const BUBBLE_RECORDING_FRAME_SIZE = 144;
const BUBBLE_PREVIEW_JPEG_QUALITY = 0.6;
const BUBBLE_RECORDING_JPEG_QUALITY = 0.55;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function startBubbleFramePump(stream: MediaStream): () => void {
  const video = document.createElement("video") as VideoWithRvfc;
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  // `autoplay` in addition to the explicit .play() below — WKWebView has
  // been observed to pause MediaStream-backed <video> elements when the
  // owning window loses visible area (e.g. shrunk during recording). The
  // autoplay attribute nudges WebKit to resume on its own once the window
  // is visible again; the heartbeat interval below catches any remaining
  // cases.
  video.autoplay = true;
  // Keep these elements off-screen and unrendered but still attached so
  // WebKit keeps decoding the track. `display: none` stops decoding in
  // some WebKit versions — a 1px offscreen layer is the safe pattern.
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
  // Canvas starts at preview size; if we enter recording mode the tick
  // loop grows/shrinks it in-place. Resizing a canvas clears it, which is
  // fine — we re-draw every frame anyway.
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
  let rafHandle: number | null = null;
  let rvfcHandle: number | null = null;

  // Defensive heartbeat: every 2s, if the video got paused (WKWebView can
  // do this when its window briefly has no on-screen pixels, or after a
  // visibility flap) nudge it back into play. Cheap when it's already
  // playing — `play()` is a no-op when the element is already playing.
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
    // Skip when the tab/popover is hidden — rAF is already throttled but
    // rVFC keeps firing on an active track, so guard it explicitly. We
    // honor a `window.clipsForceAlive` flag as an override: during recording
    // the popover is pinhole-sized (2×2) which SHOULD keep document.hidden
    // false, but WKWebView on macOS 15+ sometimes flips visibility=hidden
    // anyway when the window loses significant on-screen area. Setting the
    // force-alive flag from the recording-start path bypasses the check so
    // the bubble stays live. The same flag also serves as our "recording
    // active?" signal so we can downshift FPS / size / quality.
    const forceAlive =
      (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive ===
      true;
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

    // Throttle to the active-mode frame interval. Under both rAF and
    // rVFC the callback can fire faster than we want to encode; this is
    // the single pace-limiting gate.
    const now = performance.now();
    if (now - lastEmitMs < frameIntervalMs) return;
    lastEmitMs = now;

    // Re-size the canvas if the recording mode flipped. `<canvas>.width`
    // resets pixel data, which is fine because we redraw from the video
    // every tick.
    if (canvas.width !== frameSize) canvas.width = frameSize;
    if (canvas.height !== frameSize) canvas.height = frameSize;

    busy = true;
    try {
      // Center-crop the video into a square then scale to frameSize.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      ctx.drawImage(video, sx, sy, side, side, 0, 0, frameSize, frameSize);
      // `toDataURL` is a synchronous main-thread encode, but it avoids
      // the `toBlob` → `arrayBuffer` → `Array.from(Uint8Array)` round
      // trip which dominated the old path's main-thread cost. The
      // resulting string is a ready-to-emit JSON value — Tauri IPC
      // serializes a single string in O(bytes) with zero per-byte JS
      // allocation, vs O(bytes) allocations when serializing a number
      // array of the same length.
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (stopped) return;
      emit("clips:bubble-frame", {
        dataUrl,
        w: frameSize,
        h: frameSize,
      }).catch(() => {});
    } catch (err) {
      // Don't flood the console — one warning per failure-window is enough.
      // A transient SecurityError / NS_ERROR_NOT_AVAILABLE can happen
      // during track negotiation; the next tick will retry.
      console.warn("[clips-bubble-pump] tick failed", err);
    } finally {
      busy = false;
    }
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
