import { appBasePath } from "@agent-native/core/client";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";

/**
 * A processed camera stream whose background is blurred while the person stays
 * sharp (Zoom / Loom style). Produced once in the recorder engine and shared by
 * both the live preview bubble and the baked-in recording composite, so "what
 * you see is what's recorded".
 */
export interface CameraBlurHandle {
  /** The processed stream, or the original `source` stream when `active` is false. */
  stream: MediaStream;
  /** False when segmentation was unavailable and we transparently fell back to raw. */
  readonly active: boolean;
  /**
   * Update the background blur radius (px) live, without rebuilding the
   * segmenter. No-op on the passthrough fallback handle.
   */
  setBlurPx(px: number): void;
  cleanup(): void;
}

export interface CameraBlurOptions {
  /** CSS blur radius applied to the background, in px. Default 12. */
  blurPx?: number;
  /**
   * How often segmentation runs, in frames per second. Kept below the 30fps
   * capture rate to bound CPU/GPU cost — the small bubble does not need a fresh
   * mask every captured frame. Default 20.
   */
  segmentationFps?: number;
}

export const DEFAULT_BLUR_PX = 12;
export const MIN_BLUR_PX = 2;
export const MAX_BLUR_PX = 30;
const DEFAULT_SEGMENTATION_FPS = 20;
const CAPTURE_FPS = 30;
/**
 * Max dimension (px) of the frame we feed the segmenter. The model resizes to
 * its own 256² input internally and upsamples the mask back to this size, so
 * keeping the input small bounds the per-frame mask readback + alpha loop cost
 * regardless of the camera's native resolution. The soft mask is scaled back up
 * to the camera resolution with bilinear filtering when compositing.
 */
const SEG_MAX_DIM = 256;

const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";
const WASM_PATH = "/mediapipe/wasm";

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sourceDimensions(
  video: HTMLVideoElement,
  stream: MediaStream,
): { width: number; height: number } {
  if (positive(video.videoWidth) && positive(video.videoHeight)) {
    return { width: video.videoWidth, height: video.videoHeight };
  }
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return {
    width: positive(settings?.width) ? Math.round(settings.width) : 640,
    height: positive(settings?.height) ? Math.round(settings.height) : 480,
  };
}

/** Hidden, off-screen `<video>` that plays the source stream for canvas reads. */
function attachHiddenVideo(stream: MediaStream): {
  video: HTMLVideoElement;
  cleanup(): void;
} {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  video.style.position = "fixed";
  video.style.left = "-10000px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";

  const tryPlay = () => {
    video.play().catch(() => undefined);
  };

  document.body.appendChild(video);
  video.addEventListener("loadedmetadata", tryPlay);
  tryPlay();

  return {
    video,
    cleanup() {
      video.removeEventListener("loadedmetadata", tryPlay);
      video.pause();
      video.srcObject = null;
      video.remove();
    },
  };
}

async function createSegmenter(): Promise<ImageSegmenter> {
  // Lazy-loaded so the ~11MB Wasm runtime and its loader never enter the main
  // bundle or run during SSR — only when a recording actually requests blur.
  const vision = await import("@mediapipe/tasks-vision");
  const base = appBasePath();
  const fileset = await vision.FilesetResolver.forVisionTasks(
    `${base}${WASM_PATH}`,
  );
  const build = (delegate: "GPU" | "CPU") =>
    vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${base}${MODEL_PATH}`,
        delegate,
      },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  try {
    return await build("GPU");
  } catch {
    // Older GPUs / blocked WebGL contexts: fall back to the CPU delegate.
    return await build("CPU");
  }
}

const fallback = (source: MediaStream): CameraBlurHandle => ({
  stream: source,
  active: false,
  setBlurPx() {},
  cleanup() {},
});

/**
 * Build a background-blurred derivative of `source`. Never throws: if MediaPipe,
 * the Wasm fileset, the model, or canvas capture are unavailable, it resolves to
 * a passthrough handle wrapping the raw `source` (`active === false`) so the
 * recording always proceeds. Callers own `source`'s tracks; `cleanup()` here
 * tears down only the processing pipeline, never the source.
 */
export async function createBackgroundBlurStream(
  source: MediaStream,
  opts: CameraBlurOptions = {},
): Promise<CameraBlurHandle> {
  if (typeof document === "undefined") return fallback(source);
  if (!source.getVideoTracks().length) return fallback(source);

  let blurPx = positive(opts.blurPx) ? opts.blurPx : DEFAULT_BLUR_PX;
  const segFps = positive(opts.segmentationFps)
    ? opts.segmentationFps
    : DEFAULT_SEGMENTATION_FPS;

  const out = document.createElement("canvas");
  const outCtx = out.getContext("2d", { alpha: false });
  if (!outCtx || typeof out.captureStream !== "function") {
    return fallback(source);
  }

  let segmenter: ImageSegmenter;
  try {
    segmenter = await createSegmenter();
  } catch (err) {
    console.warn(
      "[camera-blur] Segmentation unavailable — recording without background blur:",
      err,
    );
    return fallback(source);
  }

  const hidden = attachHiddenVideo(source);
  const { width: w0, height: h0 } = sourceDimensions(hidden.video, source);
  out.width = w0;
  out.height = h0;

  // Foreground compositing scratch: sharp person punched out by the mask alpha.
  const fg = document.createElement("canvas");
  const fgCtx = fg.getContext("2d");
  // Downscaled frame we actually segment, plus the soft alpha mask it produces.
  const segInput = document.createElement("canvas");
  const segCtx = segInput.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");
  if (!fgCtx || !segCtx || !maskCtx) {
    hidden.cleanup();
    segmenter.close();
    return fallback(source);
  }

  let lastTimestamp = -1;
  let lastSegAt = -Infinity;
  let haveMask = false;
  const segIntervalMs = 1000 / segFps;

  // Re-segment into maskCanvas. Runs at segFps; on failure the previous mask is
  // kept rather than dropping to an un-blurred frame.
  const updateMask = (video: HTMLVideoElement) => {
    const scale = SEG_MAX_DIM / Math.max(video.videoWidth, video.videoHeight);
    const segW = Math.max(1, Math.round(video.videoWidth * scale));
    const segH = Math.max(1, Math.round(video.videoHeight * scale));
    if (segInput.width !== segW) segInput.width = segW;
    if (segInput.height !== segH) segInput.height = segH;
    try {
      segCtx.drawImage(video, 0, 0, segW, segH);
      const timestamp = Math.max(
        Math.round(performance.now()),
        lastTimestamp + 1,
      );
      lastTimestamp = timestamp;
      const result = segmenter.segmentForVideo(segInput, timestamp);
      const confidence = result.confidenceMasks?.[0];
      if (confidence) {
        const maskW = confidence.width;
        const maskH = confidence.height;
        const values = confidence.getAsFloat32Array();
        if (maskCanvas.width !== maskW) maskCanvas.width = maskW;
        if (maskCanvas.height !== maskH) maskCanvas.height = maskH;
        const image = maskCtx.createImageData(maskW, maskH);
        for (let i = 0; i < values.length; i++) {
          image.data[i * 4 + 3] = Math.round(values[i] * 255);
        }
        maskCtx.putImageData(image, 0, 0);
        haveMask = true;
      }
      result.close();
    } catch {
      // keep the previous mask
    }
  };

  // Composite blurred background + sharp foreground (or raw until a first mask).
  const composite = (video: HTMLVideoElement, outW: number, outH: number) => {
    if (!haveMask) {
      outCtx.drawImage(video, 0, 0, outW, outH);
      return;
    }
    if (fg.width !== outW) fg.width = outW;
    if (fg.height !== outH) fg.height = outH;
    fgCtx.globalCompositeOperation = "source-over";
    fgCtx.clearRect(0, 0, outW, outH);
    fgCtx.drawImage(video, 0, 0, outW, outH);
    fgCtx.globalCompositeOperation = "destination-in";
    fgCtx.imageSmoothingEnabled = true;
    fgCtx.drawImage(maskCanvas, 0, 0, outW, outH);
    fgCtx.globalCompositeOperation = "source-over";

    outCtx.filter = `blur(${blurPx}px)`;
    outCtx.drawImage(video, 0, 0, outW, outH);
    outCtx.filter = "none";
    outCtx.drawImage(fg, 0, 0);
  };

  // Composite every tick (capture rate) for smooth motion; re-segment only at
  // segFps, reusing the last mask in between.
  const drawFrame = () => {
    const video = hidden.video;
    if (!positive(video.videoWidth) || !positive(video.videoHeight)) return;
    if (out.width !== video.videoWidth) out.width = video.videoWidth;
    if (out.height !== video.videoHeight) out.height = video.videoHeight;

    const now = performance.now();
    if (now - lastSegAt >= segIntervalMs) {
      updateMask(video);
      lastSegAt = now;
    }
    composite(video, out.width, out.height);
  };

  const stream = out.captureStream(CAPTURE_FPS);
  const minFrameMs = 1000 / CAPTURE_FPS;

  // Worker-driven timer so the loop keeps running at full rate in background
  // tabs (rAF is throttled to ~1fps when hidden). Falls back to rAF when blob:
  // workers are blocked by CSP — mirrors camera-composite.ts.
  let worker: Worker | null = null;
  let raf: number | null = null;

  try {
    const workerBlob = new Blob(
      [
        `let t=null;onmessage=e=>{if(e.data==='start'){clearInterval(t);t=setInterval(()=>postMessage('tick'),${minFrameMs});}else if(e.data==='stop'){clearInterval(t);}};`,
      ],
      { type: "application/javascript" },
    );
    const workerUrl = URL.createObjectURL(workerBlob);
    try {
      worker = new Worker(workerUrl);
    } finally {
      URL.revokeObjectURL(workerUrl);
    }
    worker.onmessage = () => drawFrame();
    worker.postMessage("start");
  } catch (err) {
    console.warn(
      "[camera-blur] Worker timer unavailable, falling back to rAF — blur may glitch on hidden tabs:",
      err,
    );
    let lastFrameAt = 0;
    const tick = (now: number) => {
      if (raf === null) return;
      if (now - lastFrameAt >= minFrameMs) {
        lastFrameAt = now;
        drawFrame();
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
  }

  drawFrame();

  return {
    stream,
    active: true,
    setBlurPx(px: number) {
      if (positive(px)) blurPx = px;
    },
    cleanup() {
      if (worker) {
        worker.postMessage("stop");
        worker.terminate();
        worker = null;
      }
      if (raf !== null) {
        window.cancelAnimationFrame(raf);
        raf = null;
      }
      stream.getTracks().forEach((track) => track.stop());
      hidden.cleanup();
      try {
        segmenter.close();
      } catch {
        // ignore — already closed.
      }
    },
  };
}
