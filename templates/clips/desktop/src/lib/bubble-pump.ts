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
 * - Lowered to 15 FPS (bubble is a talking-head PiP; MediaRecorder still
 *   records at 30 FPS independently).
 * - Canvas 192×192 (bubble is ~180 logical px so only a hair of headroom
 *   lost) → ~44% fewer pixels per frame.
 * - JPEG quality 0.6 (self-view) → smaller blobs, faster encode.
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
 * 15 FPS (≈67ms interval) is plenty for a small talking-head circle and
 * keeps IPC bandwidth and main-thread encode time under control. At
 * 192×192 JPEG q=0.6 each frame is ~5–12KB, so ~75–180 KB/s of local IPC.
 * The bubble is ~180 logical px on retina, so a 192 source resolution is
 * comfortable without over-sampling.
 */
const BUBBLE_FPS = 15;
const BUBBLE_FRAME_INTERVAL_MS = Math.round(1000 / BUBBLE_FPS);
const BUBBLE_FRAME_SIZE = 192;
const BUBBLE_JPEG_QUALITY = 0.6;

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
  canvas.width = BUBBLE_FRAME_SIZE;
  canvas.height = BUBBLE_FRAME_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  const hasRvfc = typeof video.requestVideoFrameCallback === "function";
  console.log(
    `[clips-bubble-pump] started @ ${BUBBLE_FPS}fps (${BUBBLE_FRAME_SIZE}x${BUBBLE_FRAME_SIZE}) rvfc=${hasRvfc}`,
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

  async function encodeAndEmit(): Promise<void> {
    if (!ctx || busy || stopped) return;
    // Skip when the tab/popover is hidden — rAF is already throttled but
    // rVFC keeps firing on an active track, so guard it explicitly. Also
    // skip until the video actually has a frame (avoids an all-black
    // blip while the track negotiates).
    if (document.hidden) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    // Throttle to BUBBLE_FRAME_INTERVAL_MS. Under both rAF and rVFC the
    // callback can fire faster than we want to encode; this is the single
    // pace-limiting gate.
    const now = performance.now();
    if (now - lastEmitMs < BUBBLE_FRAME_INTERVAL_MS) return;
    lastEmitMs = now;

    busy = true;
    try {
      // Center-crop the video into a square then scale to BUBBLE_FRAME_SIZE.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      ctx.drawImage(
        video,
        sx,
        sy,
        side,
        side,
        0,
        0,
        BUBBLE_FRAME_SIZE,
        BUBBLE_FRAME_SIZE,
      );
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", BUBBLE_JPEG_QUALITY),
      );
      if (!blob || stopped) return;
      const buf = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      // Tauri event payloads are JSON-encoded — binary data must be a
      // number array. JPEG-compressed @ q=0.6 keeps this to ~5–12KB.
      await emit("clips:bubble-frame", {
        bytes,
        w: BUBBLE_FRAME_SIZE,
        h: BUBBLE_FRAME_SIZE,
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
      void encodeAndEmit();
      rafLoop();
    });
  }

  function rvfcLoop(): void {
    if (stopped || !video.requestVideoFrameCallback) return;
    rvfcHandle = video.requestVideoFrameCallback(() => {
      void encodeAndEmit();
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
