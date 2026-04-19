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
 * 1. **Aggressive recording downshift** (Option B) — 6 FPS / 112×112 /
 *    JPEG q=0.45 during recording. ~0.63% of the per-frame pixel budget
 *    we started at (256² @ 20 FPS). Self-view of yourself in a talking-
 *    head PiP is extremely forgiving — nobody's counting your pore
 *    detail in the corner of their own screen.
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

/**
 * Preview (pre-record) vs recording tuning. During recording the popover
 * is also running MediaRecorder + chunked fetch uploads on this same main
 * thread, so we downshift everything pump-related to leave headroom.
 * The `window.clipsForceAlive` flag is set by the recording-start path
 * (see `app.tsx`) and serves double duty as our "recording active?"
 * signal — no extra wiring needed.
 *
 * 15 FPS preview / 6 FPS recording:
 * - Preview feels like a live camera.
 * - Recording is a talking-head PiP of yourself. 6 FPS sustains the
 *   "this is a live camera feed, not a static image" perception while
 *   halving per-frame work vs the previous 10 FPS.
 *
 * 192px preview / 112px recording:
 * - Small bubble CSS size is ~96 logical px = 192 physical on retina.
 *   112 is 58% of that — the bubble circle + mild upscale hide the loss
 *   and the pixel-count win is large (~34% fewer pixels vs 144, ~66%
 *   fewer vs 192).
 *
 * JPEG quality 0.6 preview / 0.45 recording — self-view is forgiving,
 * and the smaller frame size means even q=0.45 artifacts are already
 * sub-pixel after the browser scales up for display.
 */
const BUBBLE_PREVIEW_FPS = 15;
const BUBBLE_RECORDING_FPS = 6;
const BUBBLE_PREVIEW_FRAME_INTERVAL_MS = Math.round(1000 / BUBBLE_PREVIEW_FPS);
const BUBBLE_RECORDING_FRAME_INTERVAL_MS = Math.round(
  1000 / BUBBLE_RECORDING_FPS,
);
const BUBBLE_PREVIEW_FRAME_SIZE = 192;
const BUBBLE_RECORDING_FRAME_SIZE = 112;
const BUBBLE_PREVIEW_JPEG_QUALITY = 0.6;
const BUBBLE_RECORDING_JPEG_QUALITY = 0.45;

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
  let lastEncodeDurationMs = 0;
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

    // Throttle to the active-mode frame interval. Under both rAF and
    // rVFC the callback can fire faster than we want to encode; this is
    // the single pace-limiting gate.
    const now = performance.now();
    if (now - lastEmitMs < frameIntervalMs) return;

    // Chunk-upload yield (recording-mode only): if the recorder's chunk
    // POST is in flight we skip this tick outright. The next rVFC tick
    // (≤33ms later) will re-check. MediaRecorder chunks land every
    // ~1000ms so the upload window is ~150-300ms of that second — the
    // pump still gets most of each second to work in. Without this,
    // toDataURL and the fetch body-serializer fight for the same
    // microtask queue and both progress at half speed.
    if (recording && w.clipsChunkBusy === true) return;

    // Adaptive skip: if the LAST encode took longer than one frame
    // interval, we've been falling behind. Drop this tick to give the
    // main thread a real break. Trailing-edge only — the next tick re-
    // evaluates fresh. This is cheap insurance against runaway pumps
    // during very hot windows (e.g. the first 2s of recording when
    // MediaRecorder is still spinning up codec state + the first chunk
    // upload hits).
    if (lastEncodeDurationMs > frameIntervalMs) {
      // Reset so we try once on the next tick instead of locking out
      // forever if the thread recovers.
      lastEncodeDurationMs = 0;
      lastEmitMs = now;
      return;
    }

    lastEmitMs = now;

    // Re-size the canvas if the recording mode flipped. `<canvas>.width`
    // resets pixel data, which is fine because we redraw from the video
    // every tick.
    if (canvas.width !== frameSize) canvas.width = frameSize;
    if (canvas.height !== frameSize) canvas.height = frameSize;

    busy = true;
    const encodeStart = performance.now();
    // Yield to the compositor before synchronous encode work. The rVFC
    // callback fires right before paint; returning quickly so WebKit can
    // composite the window frame AND our encode work keeps both
    // responsive. `queueMicrotask` runs after the current task yields
    // but before the next task — fast enough that we stay at our target
    // framerate, long enough that the compositor gets its tick.
    queueMicrotask(() => {
      if (stopped) {
        busy = false;
        return;
      }
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
