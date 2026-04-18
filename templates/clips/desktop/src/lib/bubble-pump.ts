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
 * Returns a stop fn that clears the interval and releases the hidden
 * video + canvas elements. The caller owns the MediaStream lifecycle.
 */
import { emit } from "@tauri-apps/api/event";

/**
 * 20 FPS (50ms interval) is plenty for a small talking-head circle and
 * keeps IPC bandwidth under control — at 256×256 JPEG q=0.75 each frame
 * is ~10–20KB, so ~200–400 KB/s of local IPC. The bubble is ~180 logical
 * px on retina, so a 256 source resolution has a bit of headroom for
 * resampling but stays well below raw-video size.
 */
const BUBBLE_FPS = 20;
const BUBBLE_FRAME_INTERVAL_MS = Math.round(1000 / BUBBLE_FPS);
const BUBBLE_FRAME_SIZE = 256;
const BUBBLE_JPEG_QUALITY = 0.75;

export function startBubbleFramePump(stream: MediaStream): () => void {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
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

  console.log(
    `[clips-bubble-pump] started @ ${BUBBLE_FPS}fps (${BUBBLE_FRAME_SIZE}x${BUBBLE_FRAME_SIZE})`,
  );

  let busy = false;
  const interval = setInterval(async () => {
    if (!ctx || busy) return;
    // Skip until the video actually has a frame. Cheap and avoids sending
    // an all-black frame that would briefly blank the bubble.
    if (video.readyState < 2 || video.videoWidth === 0) return;
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
      if (!blob) return;
      const buf = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      // Tauri event payloads are JSON-encoded — binary data must be a
      // number array. JPEG-compressed @ q=0.75 keeps this to ~10–20KB.
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
  }, BUBBLE_FRAME_INTERVAL_MS);

  return () => {
    clearInterval(interval);
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
