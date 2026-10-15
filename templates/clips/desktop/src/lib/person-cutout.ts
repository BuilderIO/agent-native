import type { ImageSegmenter } from "@mediapipe/tasks-vision";

// Same assets the web app serves for background blur (app/lib/camera-blur.ts).
// Imported as URLs so Vite bundles them into the desktop build.
import modelUrl from "../../../public/mediapipe/selfie_segmenter.tflite?url";
import wasmLoaderUrl from "../../../public/mediapipe/wasm/vision_wasm_internal.js?url";
import wasmBinaryUrl from "../../../public/mediapipe/wasm/vision_wasm_internal.wasm?url";

/**
 * Person cut-out on a transparent background, modelled on Loom's camera
 * bubble (Vision segmentation → contrast curve → edge-preserving upsample
 * guided by the full-resolution frame → blend over clear).
 *
 * Pipeline per frame:
 * 1. Segment the centre square of the frame at the model's native 256 px,
 *    once per new camera frame. A frame is only ever drawn with its own
 *    mask: while segmentation is throttled the previous cut-out is held,
 *    since a new frame under an older mask leaves a band of background
 *    where the person just was. Segmenting at native size also means
 *    no mask resolution is spent on the area the bubble crops away.
 * 2. Smooth the confidence mask over time, adaptively: small changes
 *    (flicker) are averaged out, large changes (motion) pass through.
 * 3. On the GPU, upsample the mask with a joint bilateral filter guided by
 *    the full-resolution frame, so edges snap to the real silhouette
 *    instead of a blurry 256 px outline; then apply the contrast curve,
 *    pull fringe colour towards the nearby foreground (less background
 *    halo) and write premultiplied alpha.
 *
 * Falls back to a Canvas 2D `destination-in` composite when WebGL2 is not
 * available.
 */
export interface PersonCutout {
  /**
   * Cuts the person out of the centre square of `source` into a square
   * alpha canvas of `size` px. Not mirrored. Returns null until the first
   * mask is ready.
   */
  render(source: CanvasImageSource, size: number): HTMLCanvasElement | null;
  close(): void;
}

export interface PersonCutoutOptions {
  /** Canvas to draw into (e.g. one already in the DOM); created if absent. */
  canvas?: HTMLCanvasElement;
  /** Upper bound for segmentation runs per second. */
  maxSegmentationFps?: number;
}

const SEG_SIZE = 256;
const DEFAULT_MAX_SEGMENTATION_FPS = 30;
const MIN_SEGMENTATION_FPS = 12;
// Keep segmentation below about half of the frame budget it runs in.
const SEGMENTATION_BUDGET_FACTOR = 2;
// Camera frames arrive with jitter; a frame that lands slightly early must
// not wait for the next one.
const SEGMENTATION_SLACK_MS = 8;
// requestVideoFrameCallback is trusted only while it keeps firing; a
// hidden <video> may stop presenting frames.
const FRAME_CALLBACK_STALE_MS = 250;

// Temporal filter: weight of the newest mask grows with how much it moved.
const TEMPORAL_MIN_WEIGHT = 0.35;
const TEMPORAL_MOTION_GAIN = 4;

// Contrast curve applied after upsampling: below LOW is background, above
// HIGH is person.
const MASK_LOW = 0.3;
const MASK_HIGH = 0.7;
// Joint bilateral weights: spatial sigma in mask pixels, colour sigma in
// 0..1 RGB units.
const SPATIAL_SIGMA = 1;
const RANGE_SIGMA = 0.1;
// How strongly semi-transparent edge pixels take the foreground colour.
const DECONTAMINATION = 0.6;
// Fraction of the bottom edge faded out so the shoulders don't end in a
// hard horizontal line.
const BOTTOM_FADE = 0.04;
// Canvas 2D fallback only.
const FALLBACK_FEATHER_PX = 1.5;

export interface CentreSquare {
  x: number;
  y: number;
  size: number;
}

/** Largest centred square of a `width` x `height` frame (CSS `cover`). */
export function centreSquare(width: number, height: number): CentreSquare {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

/**
 * Motion-adaptive temporal smoothing of a confidence mask. `state` holds the
 * last smoothed mask and is updated in place; the result is also written to
 * `out` as 0..255. With `hasPrevious` false the mask is taken as is.
 */
export function smoothMask(
  confidence: Float32Array,
  state: Float32Array,
  out: Uint8Array,
  hasPrevious: boolean,
): void {
  for (let i = 0; i < confidence.length; i++) {
    const next = Math.min(1, Math.max(0, confidence[i]));
    let value = next;
    if (hasPrevious) {
      const previous = state[i];
      const weight = Math.min(
        1,
        TEMPORAL_MIN_WEIGHT + Math.abs(next - previous) * TEMPORAL_MOTION_GAIN,
      );
      value = previous + (next - previous) * weight;
    }
    state[i] = value;
    out[i] = Math.round(value * 255);
  }
}

/**
 * Milliseconds between segmentation runs: as often as `maxFps` allows while
 * segmentation stays within its share of the frame budget, but never below
 * MIN_SEGMENTATION_FPS.
 */
export function segmentationInterval(
  averageCostMs: number,
  maxFps: number,
): number {
  const fastest = 1000 / maxFps;
  const slowest = 1000 / Math.min(maxFps, MIN_SEGMENTATION_FPS);
  return Math.min(
    slowest,
    Math.max(fastest, averageCostMs * SEGMENTATION_BUDGET_FACTOR),
  );
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface FrameWatch {
  video: VideoWithFrameCallback;
  handle: number;
  /** Frames presented since watching started. */
  frames: number;
  lastFrameAt: number;
}

function sourceSize(source: CanvasImageSource): {
  width: number;
  height: number;
} {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  const sized = source as { width?: unknown; height?: unknown };
  return {
    width: typeof sized.width === "number" ? sized.width : 0,
    height: typeof sized.height === "number" ? sized.height : 0,
  };
}

async function createSegmenter(): Promise<ImageSegmenter> {
  const vision = await import("@mediapipe/tasks-vision");
  const build = (delegate: "GPU" | "CPU") =>
    vision.ImageSegmenter.createFromOptions(
      { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
      {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      },
    );
  try {
    return await build("GPU");
  } catch {
    return await build("CPU");
  }
}

// --- Compositors -----------------------------------------------------------

interface MaskFrame {
  /** Smoothed mask, SEG_SIZE x SEG_SIZE, 0..255. */
  mask: Uint8Array;
  /** The SEG_SIZE x SEG_SIZE frame the mask was computed from. */
  guide: HTMLCanvasElement;
}

interface Compositor {
  /**
   * Draws the cut-out of `crop` from `source` into the canvas. With
   * `newFrame` false the frame the mask belongs to is redrawn (e.g. on a
   * resize) where the compositor kept it.
   */
  draw(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    crop: CentreSquare,
    size: number,
    maskFrame: MaskFrame,
    maskChanged: boolean,
    newFrame: boolean,
  ): void;
  close(): void;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  // Clip space is y-up; vUv is y-down to match image rows.
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFrame;
uniform sampler2D uMask;
uniform sampler2D uGuide;
uniform vec4 uCrop;        // xy = uv offset, zw = uv scale of the crop
uniform float uMaskSize;
uniform float uSpatial;    // 1 / (2 sigma_s^2)
uniform float uRange;      // 1 / (2 sigma_r^2)
uniform vec2 uCurve;       // contrast curve low / high
uniform float uDecontam;
uniform float uBottomFade;

void main() {
  vec3 color = texture(uFrame, uCrop.xy + vUv * uCrop.zw).rgb;
  // Position in mask pixel units; taps cover the 4x4 neighbourhood.
  vec2 p = vUv * uMaskSize - 0.5;
  vec2 base = floor(p);
  float weightSum = 0.0;
  float maskSum = 0.0;
  vec3 fgSum = vec3(0.0);
  float fgWeight = 0.0;
  for (int j = -1; j <= 2; j++) {
    for (int i = -1; i <= 2; i++) {
      vec2 q = base + vec2(float(i), float(j));
      vec2 uv = (q + 0.5) / uMaskSize;
      float m = texture(uMask, uv).r;
      vec3 g = texture(uGuide, uv).rgb;
      vec2 d = p - q;
      float spatial = exp(-dot(d, d) * uSpatial);
      vec3 dc = color - g;
      float w = spatial * exp(-dot(dc, dc) * uRange) + 1e-4 * spatial;
      weightSum += w;
      maskSum += w * m;
      float fw = spatial * m * m * m;
      fgSum += fw * g;
      fgWeight += fw;
    }
  }
  float alpha = smoothstep(uCurve.x, uCurve.y, maskSum / weightSum);
  alpha *= smoothstep(0.0, uBottomFade, 1.0 - vUv.y);
  if (fgWeight > 1e-3) {
    // Strongest where the edge is half transparent; solid pixels keep
    // their own colour.
    float pull = uDecontam * 4.0 * alpha * (1.0 - alpha);
    color = mix(color, fgSum / fgWeight, pull);
  }
  outColor = vec4(color * alpha, alpha);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Cut-out shader failed to compile: ${log}`);
  }
  return shader;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Could not create texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createWebglCompositor(canvas: HTMLCanvasElement): Compositor | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    // The canvas is read back with drawImage by the recording compositor.
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  const program = gl.createProgram();
  if (!program) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Cut-out shader failed to link: ${log}`);
  }
  gl.useProgram(program);

  const quad = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const frameTexture = createTexture(gl);
  const maskTexture = createTexture(gl);
  const guideTexture = createTexture(gl);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(uniform("uFrame"), 0);
  gl.uniform1i(uniform("uMask"), 1);
  gl.uniform1i(uniform("uGuide"), 2);
  gl.uniform1f(uniform("uMaskSize"), SEG_SIZE);
  gl.uniform1f(uniform("uSpatial"), 1 / (2 * SPATIAL_SIGMA * SPATIAL_SIGMA));
  gl.uniform1f(uniform("uRange"), 1 / (2 * RANGE_SIGMA * RANGE_SIGMA));
  gl.uniform2f(uniform("uCurve"), MASK_LOW, MASK_HIGH);
  gl.uniform1f(uniform("uDecontam"), DECONTAMINATION);
  gl.uniform1f(uniform("uBottomFade"), BOTTOM_FADE);
  const cropLocation = uniform("uCrop");
  let haveFrame = false;

  return {
    draw(
      source,
      sourceWidth,
      sourceHeight,
      crop,
      size,
      maskFrame,
      maskChanged,
      newFrame,
    ) {
      if (canvas.width !== size) canvas.width = size;
      if (canvas.height !== size) canvas.height = size;
      gl.viewport(0, 0, size, size);

      if (newFrame || !haveFrame) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frameTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source as TexImageSource,
        );
        haveFrame = true;
      }
      if (maskChanged) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R8,
          SEG_SIZE,
          SEG_SIZE,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          maskFrame.mask,
        );
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, guideTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          maskFrame.guide,
        );
      }
      gl.uniform4f(
        cropLocation,
        crop.x / sourceWidth,
        crop.y / sourceHeight,
        crop.size / sourceWidth,
        crop.size / sourceHeight,
      );
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    close() {
      gl.deleteTexture(frameTexture);
      gl.deleteTexture(maskTexture);
      gl.deleteTexture(guideTexture);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

function createCanvas2dCompositor(canvas: HTMLCanvasElement): Compositor {
  const ctx = canvas.getContext("2d", { alpha: true });
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = SEG_SIZE;
  maskCanvas.height = SEG_SIZE;
  const maskCtx = maskCanvas.getContext("2d");
  if (!ctx || !maskCtx) {
    throw new Error("Canvas 2D is unavailable for the camera cut-out.");
  }
  const maskImage = maskCtx.createImageData(SEG_SIZE, SEG_SIZE);
  const span = MASK_HIGH - MASK_LOW;

  return {
    draw(
      source,
      _sourceWidth,
      _sourceHeight,
      crop,
      size,
      maskFrame,
      maskChanged,
    ) {
      if (maskChanged) {
        const rgba = maskImage.data;
        for (let i = 0; i < maskFrame.mask.length; i++) {
          const t = Math.min(
            1,
            Math.max(0, (maskFrame.mask[i] / 255 - MASK_LOW) / span),
          );
          rgba[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
        }
        maskCtx.putImageData(maskImage, 0, 0);
      }
      if (canvas.width !== size) canvas.width = size;
      if (canvas.height !== size) canvas.height = size;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(
        source,
        crop.x,
        crop.y,
        crop.size,
        crop.size,
        0,
        0,
        size,
        size,
      );
      ctx.globalCompositeOperation = "destination-in";
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.filter = `blur(${FALLBACK_FEATHER_PX}px)`;
      ctx.drawImage(maskCanvas, 0, 0, size, size);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
    },
    close() {},
  };
}

// --- Cut-out ---------------------------------------------------------------

export async function createPersonCutout(
  opts: PersonCutoutOptions = {},
): Promise<PersonCutout> {
  const segmenter = await createSegmenter();
  const maxFps = opts.maxSegmentationFps ?? DEFAULT_MAX_SEGMENTATION_FPS;
  const canvas = opts.canvas ?? document.createElement("canvas");

  const guide = document.createElement("canvas");
  guide.width = SEG_SIZE;
  guide.height = SEG_SIZE;
  const guideCtx = guide.getContext("2d", { willReadFrequently: false });
  if (!guideCtx) {
    segmenter.close();
    throw new Error("Canvas 2D is unavailable for the camera cut-out.");
  }

  let compositor: Compositor;
  try {
    compositor =
      createWebglCompositor(canvas) ?? createCanvas2dCompositor(canvas);
  } catch (err) {
    console.warn("[person-cutout] WebGL compositor unavailable", err);
    try {
      compositor = createCanvas2dCompositor(canvas);
    } catch (fallbackErr) {
      segmenter.close();
      throw fallbackErr;
    }
  }

  const maskFrame: MaskFrame = {
    mask: new Uint8Array(SEG_SIZE * SEG_SIZE),
    guide,
  };
  const smoothed = new Float32Array(SEG_SIZE * SEG_SIZE);
  let closed = false;
  let haveMask = false;
  let maskChanged = false;
  let lastSegAt = -Infinity;
  let lastTimestamp = -1;
  let averageCostMs = 0;
  let drawnSize = 0;
  let frameWatch: FrameWatch | null = null;
  let segmentedFrames = -1;

  const stopWatchingFrames = () => {
    if (!frameWatch) return;
    frameWatch.video.cancelVideoFrameCallback?.(frameWatch.handle);
    frameWatch = null;
  };

  // Counts presented frames of a <video> source so each one is segmented
  // once. Other sources (canvas pump) are segmented on the time budget.
  const watchFrames = (source: CanvasImageSource): FrameWatch | null => {
    const video =
      source instanceof HTMLVideoElement
        ? (source as VideoWithFrameCallback)
        : null;
    if (!video || typeof video.requestVideoFrameCallback !== "function") {
      stopWatchingFrames();
      return null;
    }
    if (frameWatch?.video === video) return frameWatch;
    stopWatchingFrames();
    const watch: FrameWatch = {
      video,
      handle: 0,
      frames: 0,
      lastFrameAt: -Infinity,
    };
    const onFrame = () => {
      if (frameWatch !== watch) return;
      watch.frames++;
      watch.lastFrameAt = performance.now();
      watch.handle = video.requestVideoFrameCallback!(onFrame);
    };
    watch.handle = video.requestVideoFrameCallback(onFrame);
    frameWatch = watch;
    segmentedFrames = -1;
    return watch;
  };

  const updateMask = (source: CanvasImageSource, crop: CentreSquare): void => {
    const startedAt = performance.now();
    guideCtx.drawImage(
      source,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      SEG_SIZE,
      SEG_SIZE,
    );
    const timestamp = Math.max(Math.round(startedAt), lastTimestamp + 1);
    lastTimestamp = timestamp;
    const result = segmenter.segmentForVideo(guide, timestamp);
    try {
      const confidence = result.confidenceMasks?.[0];
      if (
        !confidence ||
        confidence.width !== SEG_SIZE ||
        confidence.height !== SEG_SIZE
      ) {
        return;
      }
      smoothMask(
        confidence.getAsFloat32Array(),
        smoothed,
        maskFrame.mask,
        haveMask,
      );
      haveMask = true;
      maskChanged = true;
    } finally {
      result.close();
      const cost = performance.now() - startedAt;
      averageCostMs = averageCostMs ? averageCostMs * 0.8 + cost * 0.2 : cost;
    }
  };

  return {
    render(source, size) {
      if (closed || size <= 0) return null;
      const { width, height } = sourceSize(source);
      if (width <= 0 || height <= 0) return null;
      const crop = centreSquare(width, height);

      const now = performance.now();
      const watch = watchFrames(source);
      const framesLive =
        watch !== null && now - watch.lastFrameAt < FRAME_CALLBACK_STALE_MS;
      const newFrame = framesLive ? watch.frames !== segmentedFrames : true;
      if (
        newFrame &&
        now - lastSegAt >=
          segmentationInterval(averageCostMs, maxFps) - SEGMENTATION_SLACK_MS
      ) {
        lastSegAt = now;
        if (framesLive) segmentedFrames = watch.frames;
        try {
          updateMask(source, crop);
        } catch (err) {
          // Keep the previous mask and frame.
          console.debug("[person-cutout] segmentation failed", err);
        }
      }
      if (!haveMask) return null;

      // Only redraw with a fresh mask (or at a new size); otherwise the
      // canvas keeps the last frame drawn with its own mask.
      const roundedSize = Math.round(size);
      if (maskChanged || roundedSize !== drawnSize) {
        compositor.draw(
          source,
          width,
          height,
          crop,
          roundedSize,
          maskFrame,
          maskChanged,
          maskChanged,
        );
        drawnSize = roundedSize;
        maskChanged = false;
      }
      return canvas;
    },
    close() {
      if (closed) return;
      closed = true;
      stopWatchingFrames();
      compositor.close();
      try {
        segmenter.close();
      } catch (err) {
        console.debug("[person-cutout] segmenter already closed", err);
      }
    },
  };
}
