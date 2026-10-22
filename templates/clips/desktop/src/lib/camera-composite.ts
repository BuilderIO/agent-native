import { createPersonCutout, type PersonCutout } from "./person-cutout";

type CameraBubbleAnchor = "bottom-left" | "bottom-right";

interface CameraCompositeOptions {
  displayStream: MediaStream;
  cameraStream: MediaStream;
  frameRate?: number;
  bubbleSizeRatio?: number;
  bubbleMinPx?: number;
  bubbleMaxPx?: number;
  bubbleMarginRatio?: number;
  anchor?: CameraBubbleAnchor;
  /** Draw only the person inside the circle, without its fill and border. */
  cutout?: boolean;
  /** Follows live changes of the cut-out toggle during the recording. */
  subscribeCutout?: (onChange: (enabled: boolean) => void) => () => void;
}

export interface CameraCompositeHandle {
  stream: MediaStream;
  cleanup(): void;
}

const DEFAULT_FRAME_RATE = 30;
const DEFAULT_BUBBLE_SIZE_RATIO = 0.18;
const DEFAULT_BUBBLE_MIN_PX = 96;
const DEFAULT_BUBBLE_MAX_PX = 280;
const DEFAULT_BUBBLE_MARGIN_RATIO = 0.04;
// While the cut-out warms up, leave the bubble out instead of flashing the
// round camera; draw the circle only if that takes longer than this.
const CUTOUT_LOAD_GRACE_MS = 2000;

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function streamDimensions(stream: MediaStream): {
  width: number;
  height: number;
} {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return {
    width: positiveNumber(settings?.width) ? Math.round(settings.width) : 1280,
    height: positiveNumber(settings?.height)
      ? Math.round(settings.height)
      : 720,
  };
}

function videoDimensions(
  video: HTMLVideoElement,
  stream: MediaStream,
): { width: number; height: number } {
  if (positiveNumber(video.videoWidth) && positiveNumber(video.videoHeight)) {
    return { width: video.videoWidth, height: video.videoHeight };
  }
  return streamDimensions(stream);
}

function attachVideo(stream: MediaStream): {
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

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror = false,
): void {
  if (!positiveNumber(video.videoWidth) || !positiveNumber(video.videoHeight)) {
    return;
  }

  const sourceAspect = video.videoWidth / video.videoHeight;
  const targetAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;

  if (sourceAspect > targetAspect) {
    sw = video.videoHeight * targetAspect;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth / targetAspect;
    sy = (video.videoHeight - sh) / 2;
  }

  ctx.save();
  if (mirror) {
    ctx.translate(x + width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, x, y, width, height);
  }
  ctx.restore();
}

function resizeCanvasToDisplay(
  canvas: HTMLCanvasElement,
  displayVideo: HTMLVideoElement,
  displayStream: MediaStream,
): void {
  const { width, height } = videoDimensions(displayVideo, displayStream);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function drawCameraBubble(
  ctx: CanvasRenderingContext2D,
  cameraVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: Required<
    Pick<
      CameraCompositeOptions,
      | "bubbleSizeRatio"
      | "bubbleMinPx"
      | "bubbleMaxPx"
      | "bubbleMarginRatio"
      | "anchor"
    >
  >,
  cutout: CutoutDrawState = { mode: "off" },
): void {
  const minDimension = Math.min(canvas.width, canvas.height);
  const maxSize = Math.min(options.bubbleMaxPx, minDimension * 0.42);
  const size = Math.round(
    clamp(
      minDimension * options.bubbleSizeRatio,
      Math.min(options.bubbleMinPx, maxSize),
      maxSize,
    ),
  );
  const margin = Math.round(
    clamp(minDimension * options.bubbleMarginRatio, 24, 80),
  );
  const x =
    options.anchor === "bottom-right" ? canvas.width - size - margin : margin;
  const y = canvas.height - size - margin;
  if (cutout.mode === "on") {
    if (
      cutout.personCutout &&
      drawPersonCutout(ctx, cameraVideo, cutout.personCutout, x, y, size)
    ) {
      return;
    }
    // No cut-out frame yet: leave the bubble out rather than flash the
    // circle, unless the segmenter is taking too long.
    if (!cutout.pastGrace) return;
  }

  const radius = size / 2;
  const centerX = x + radius;
  const centerY = y + radius;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = Math.max(16, size * 0.12);
  ctx.shadowOffsetY = Math.max(8, size * 0.05);
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, size, size);
  drawCover(ctx, cameraVideo, x, y, size, size, true);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = Math.max(4, Math.round(size * 0.025));
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

type CutoutDrawState =
  | { mode: "off" }
  | { mode: "on"; personCutout: PersonCutout | null; pastGrace: boolean };

let cutoutScratch: HTMLCanvasElement | null = null;

function drawPersonCutout(
  ctx: CanvasRenderingContext2D,
  cameraVideo: HTMLVideoElement,
  personCutout: PersonCutout,
  x: number,
  y: number,
  size: number,
): boolean {
  // Render at device pixels of the bubble; the cut-out is square already.
  const pixels = Math.ceil(size);
  const frame = personCutout.render(cameraVideo, pixels);
  if (!frame) return false;

  // Clip to the bubble circle off-screen first, so the shadow below follows
  // the clipped silhouette instead of being cut off by the clip.
  const scratch = (cutoutScratch ??= document.createElement("canvas"));
  if (scratch.width !== pixels) scratch.width = pixels;
  if (scratch.height !== pixels) scratch.height = pixels;
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) return false;
  scratchCtx.clearRect(0, 0, pixels, pixels);
  scratchCtx.save();
  scratchCtx.beginPath();
  scratchCtx.arc(pixels / 2, pixels / 2, pixels / 2, 0, Math.PI * 2);
  scratchCtx.clip();
  // Mirrored like the on-screen bubble.
  scratchCtx.translate(pixels, 0);
  scratchCtx.scale(-1, 1);
  scratchCtx.drawImage(frame, 0, 0, pixels, pixels);
  scratchCtx.restore();

  ctx.save();
  // guard:allow-raw-color — shadow is baked into the recording, theme-invariant
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = Math.max(12, size * 0.06);
  ctx.shadowOffsetY = Math.max(4, size * 0.025);
  ctx.drawImage(scratch, x, y, size, size);
  ctx.restore();
  return true;
}

export function createCameraCompositeStream(
  options: CameraCompositeOptions,
): CameraCompositeHandle {
  if (typeof document === "undefined") {
    throw new Error("Camera compositing requires a browser document.");
  }
  const displayTrack = options.displayStream.getVideoTracks()[0];
  const cameraTrack = options.cameraStream.getVideoTracks()[0];
  if (!displayTrack || !cameraTrack) {
    throw new Error("Camera compositing requires display and camera video.");
  }

  const frameRate = options.frameRate ?? DEFAULT_FRAME_RATE;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx || typeof canvas.captureStream !== "function") {
    throw new Error(
      "This WebView cannot composite camera video into screen recordings.",
    );
  }

  const display = attachVideo(options.displayStream);
  const camera = attachVideo(options.cameraStream);
  const drawOptions = {
    bubbleSizeRatio: options.bubbleSizeRatio ?? DEFAULT_BUBBLE_SIZE_RATIO,
    bubbleMinPx: options.bubbleMinPx ?? DEFAULT_BUBBLE_MIN_PX,
    bubbleMaxPx: options.bubbleMaxPx ?? DEFAULT_BUBBLE_MAX_PX,
    bubbleMarginRatio: options.bubbleMarginRatio ?? DEFAULT_BUBBLE_MARGIN_RATIO,
    anchor: options.anchor ?? "bottom-left",
  };

  let stopped = false;
  let cutoutEnabled = options.cutout === true;
  let cutoutRequestedAt = 0;
  let cutoutFailed = false;
  let personCutout: PersonCutout | null = null;
  let personCutoutPending = false;

  const ensurePersonCutout = () => {
    if (personCutout || personCutoutPending || cutoutFailed) return;
    personCutoutPending = true;
    cutoutRequestedAt = performance.now();
    createPersonCutout()
      .then((created) => {
        if (stopped) created.close();
        else personCutout = created;
      })
      .catch((err) => {
        cutoutFailed = true;
        console.warn(
          "[camera-composite] person cut-out unavailable — recording the round bubble:",
          err,
        );
      })
      .finally(() => {
        personCutoutPending = false;
      });
  };
  if (cutoutEnabled) ensurePersonCutout();
  const unsubscribeCutout = options.subscribeCutout?.((enabled) => {
    cutoutEnabled = enabled;
    if (enabled) ensurePersonCutout();
  });

  const cutoutDrawState = (): CutoutDrawState => {
    if (!cutoutEnabled || cutoutFailed) return { mode: "off" };
    return {
      mode: "on",
      personCutout,
      pastGrace: performance.now() - cutoutRequestedAt >= CUTOUT_LOAD_GRACE_MS,
    };
  };

  resizeCanvasToDisplay(canvas, display.video, options.displayStream);
  const stream = canvas.captureStream(frameRate);
  let raf: number | null = null;
  let lastFrameAt = 0;
  const minFrameMs = 1000 / frameRate;

  const drawFrame = () => {
    resizeCanvasToDisplay(canvas, display.video, options.displayStream);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      ctx.drawImage(display.video, 0, 0, canvas.width, canvas.height);
    } catch {
      // The display video can be momentarily unavailable while metadata loads.
    }
    drawCameraBubble(ctx, camera.video, canvas, drawOptions, cutoutDrawState());
  };

  const tick = (now: number) => {
    if (stopped) return;
    if (now - lastFrameAt >= minFrameMs) {
      lastFrameAt = now;
      drawFrame();
    }
    raf = window.requestAnimationFrame(tick);
  };

  drawFrame();
  raf = window.requestAnimationFrame(tick);

  return {
    stream,
    cleanup() {
      stopped = true;
      if (raf !== null) {
        window.cancelAnimationFrame(raf);
        raf = null;
      }
      stream.getTracks().forEach((track) => track.stop());
      unsubscribeCutout?.();
      personCutout?.close();
      personCutout = null;
      display.cleanup();
      camera.cleanup();
    },
  };
}
