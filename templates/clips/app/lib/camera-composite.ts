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
}

export interface CameraCompositeHandle {
  stream: MediaStream;
  cleanup(): void;
}

const DEFAULT_FRAME_RATE = 30;
const DEFAULT_BUBBLE_SIZE_RATIO = 0.22;
const DEFAULT_BUBBLE_MIN_PX = 96;
const DEFAULT_BUBBLE_MAX_PX = 320;
const DEFAULT_BUBBLE_MARGIN_RATIO = 0.04;

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

const MAX_CANVAS_DIMENSION_PX = 1920;

export function clampToMaxDimension(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_CANVAS_DIMENSION_PX) {
    return { width, height };
  }
  const scale = MAX_CANVAS_DIMENSION_PX / longest;
  return {
    width: Math.round((width * scale) / 2) * 2,
    height: Math.round((height * scale) / 2) * 2,
  };
}

export function cameraBubbleStrokeRadius(
  size: number,
  lineWidth: number,
): number {
  return Math.max(0, size / 2 - lineWidth / 2);
}

function resizeCanvasToDisplay(
  canvas: HTMLCanvasElement,
  displayVideo: HTMLVideoElement,
  displayStream: MediaStream,
): void {
  const source = videoDimensions(displayVideo, displayStream);
  const { width, height } = clampToMaxDimension(source.width, source.height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

interface BubbleShadowSprite {
  size: number;
  canvas: HTMLCanvasElement;
  pad: number;
}

let bubbleShadowSprite: BubbleShadowSprite | null = null;

function getBubbleShadowSprite(size: number): BubbleShadowSprite {
  if (bubbleShadowSprite && bubbleShadowSprite.size === size) {
    return bubbleShadowSprite;
  }
  const blur = Math.max(16, size * 0.12);
  const offsetY = Math.max(8, size * 0.05);
  const pad = Math.ceil(blur * 2 + offsetY);
  const spriteSize = size + pad * 2;
  const sprite = document.createElement("canvas");
  sprite.width = spriteSize;
  sprite.height = spriteSize;
  const sctx = sprite.getContext("2d");
  if (sctx) {
    const radius = size / 2;
    const center = pad + radius;
    sctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    sctx.shadowBlur = blur;
    sctx.shadowOffsetY = offsetY;
    sctx.fillStyle = "#000";
    sctx.beginPath();
    sctx.arc(center, center, radius, 0, Math.PI * 2);
    sctx.fill();
  }
  bubbleShadowSprite = { size, canvas: sprite, pad };
  return bubbleShadowSprite;
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
  if (size <= 0) return;
  const margin = Math.round(
    clamp(minDimension * options.bubbleMarginRatio, 24, 80),
  );
  const x =
    options.anchor === "bottom-right" ? canvas.width - size - margin : margin;
  const y = canvas.height - size - margin;
  const radius = size / 2;
  const centerX = x + radius;
  const centerY = y + radius;

  const shadow = getBubbleShadowSprite(size);
  ctx.drawImage(
    shadow.canvas,
    centerX - shadow.pad - radius,
    centerY - shadow.pad - radius,
  );

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
  ctx.arc(
    centerX,
    centerY,
    cameraBubbleStrokeRadius(size, ctx.lineWidth),
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();
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
      "This browser cannot composite camera video into screen recordings.",
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

  resizeCanvasToDisplay(canvas, display.video, options.displayStream);
  const stream = canvas.captureStream(frameRate);
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
    if (cameraTrack.readyState !== "ended") {
      drawCameraBubble(ctx, camera.video, canvas, drawOptions);
    }
  };

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
      "[camera-composite] Worker timer unavailable, falling back to rAF — recording may glitch on hidden tabs:",
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
    cleanup() {
      if (worker) {
        worker.postMessage("stop");
        worker.terminate();
      }
      if (raf !== null) {
        window.cancelAnimationFrame(raf);
        raf = null;
      }
      stream.getTracks().forEach((track) => track.stop());
      display.cleanup();
      camera.cleanup();
    },
  };
}
