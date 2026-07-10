import { callAction } from "@agent-native/core/client";

import type { DrawAnnotation } from "@/components/visual-editor";

/**
 * Draw-to-agent visual capture.
 *
 * DrawOverlay's `onSend` still hands the caller a text summary of stroke
 * paths and text labels (see DesignCanvas's `onSend` wiring) — that stays,
 * because raw coordinates remain useful for precision edits. This module
 * additionally rasterizes the annotated screen into ONE PNG the agent can
 * actually see, mirroring the Claude-design-style "draw over a screenshot"
 * flow instead of forcing the agent to reconstruct a picture from
 * coordinates alone.
 *
 * Pipeline: reuse `take-design-screenshot` (already renders the live screen
 * server-side via headless Chromium — see that action's docblock) at the
 * exact on-screen rect the user drew on, composite the serialized
 * strokes/text on top client-side, then hand the finished PNG to the shared
 * `upload-image` core action so only a durable URL — never base64 — reaches
 * the agent chat message or any persisted state.
 *
 * Every step degrades silently to `null` (no thrown errors): a missing
 * Chromium binary in hosted/serverless deploys, a slow render, a network
 * blip fetching the screenshot, or an unconfigured upload provider should
 * never block the user's drawing from reaching the agent as text — see
 * `captureAnnotatedScreenshot`'s caller in DesignCanvas.tsx, which always
 * falls through to the text-only summary.
 */

/** Bounds the whole capture pipeline so a slow/hung Chromium render or
 * upload never leaves the user waiting indefinitely to see their message
 * land in chat. Generous enough for a local Playwright cold start. */
const CAPTURE_TIMEOUT_MS = 9000;

const MIN_DIMENSION_PX = 200;
const MAX_WIDTH_PX = 3840;
const MAX_HEIGHT_PX = 4096;

interface TakeDesignScreenshotResult {
  ok: boolean;
  reason?: string;
  screenshots?: Array<{ url?: string }>;
}

interface UploadImageResult {
  url?: string;
  error?: string;
}

export interface CaptureAnnotatedScreenshotOptions {
  /** Stable design id — used as fallback screen lookup and upload filename. */
  designId?: string;
  /** Specific design_files.id for the annotated screen. Preferred lookup key. */
  fileId?: string;
  /** Filename fallback when `fileId` is not available (paired with `designId`). */
  filename?: string;
  /** Only inline (SQL-backed HTML) screens can be rendered by take-design-screenshot. */
  sourceType?: "inline" | "localhost" | "fusion";
  annotations: DrawAnnotation[];
  /** Layout-space canvas size the annotations were serialized against. */
  canvasSize: { width: number; height: number };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`annotation screenshot capture timed out after ${ms}ms`),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Failed to decode screenshot image"));
    image.src = url;
  });
}

/**
 * Draw one annotation (a stroke path or a text label) onto a 2D canvas
 * context, in the same layout-pixel coordinate space DrawOverlay used when
 * it serialized `pathData`/`position` in its own `send()` — see
 * DrawOverlay.tsx's coordinate-model docblock. Parses the "M x,y L x,y ..."
 * syntax with a small regex instead of `new Path2D(...)`: this is the exact
 * (and only) format DrawOverlay's `send()` emits, and avoiding Path2D keeps
 * this rasterizer testable against a plain fake context object — Path2D
 * isn't implemented in jsdom/happy-dom, only real browsers. Exported for unit
 * testing against a fake context (canvas 2D isn't implemented in jsdom).
 */
export function drawAnnotationsOnContext(
  ctx: Pick<
    CanvasRenderingContext2D,
    | "save"
    | "restore"
    | "beginPath"
    | "moveTo"
    | "lineTo"
    | "stroke"
    | "fillText"
    | "strokeStyle"
    | "fillStyle"
    | "lineWidth"
    | "lineCap"
    | "lineJoin"
    | "font"
    | "textBaseline"
  >,
  annotations: DrawAnnotation[],
): void {
  for (const annotation of annotations) {
    if (annotation.type === "path" && annotation.pathData) {
      const points = parsePathDataPoints(annotation.pathData);
      if (points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (annotation.type === "text" && annotation.text) {
      ctx.save();
      ctx.fillStyle = annotation.color;
      ctx.font = `600 ${14 + annotation.lineWidth}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(
        annotation.text,
        annotation.position.x,
        annotation.position.y,
      );
      ctx.restore();
    }
  }
}

const PATH_DATA_POINT_RE = /[ML]\s*(-?[\d.]+),(-?[\d.]+)/g;

/** Parse DrawOverlay's `"M x,y L x,y L x,y"` path syntax into raw points. */
function parsePathDataPoints(
  pathData: string,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const match of pathData.matchAll(PATH_DATA_POINT_RE)) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

/** Fetch the screenshot bytes (avoids canvas cross-origin tainting — a
 * same-process `fetch` + `Blob` object URL is never "foreign" to the canvas,
 * regardless of the storage provider's CORS headers) and composite the
 * annotations on top at the exact requested pixel size. */
async function compositeScreenshotWithAnnotations(
  screenshotUrl: string,
  annotations: DrawAnnotation[],
  size: { width: number; height: number },
): Promise<string | null> {
  const response = await fetch(screenshotUrl);
  if (!response.ok) return null;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageFromUrl(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, size.width, size.height);
    drawAnnotationsOnContext(ctx, annotations);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Best-effort: render the annotated screen, composite the drawing on top,
 * and upload the result. Returns the durable image URL, or `null` on ANY
 * failure (missing Chromium, no upload provider configured, network error,
 * unsupported source type, timeout) — callers must treat `null` as "fall
 * back to the text-only summary", never as a reason to drop the annotation.
 */
export async function captureAnnotatedScreenshot(
  options: CaptureAnnotatedScreenshotOptions,
): Promise<string | null> {
  const { designId, fileId, filename, sourceType, annotations, canvasSize } =
    options;

  // take-design-screenshot renders stored SQL/collab HTML content; localhost
  // and fusion screens hold a URL, not renderable HTML, so skip straight to
  // the text-only fallback for those instead of paying for a doomed render.
  if (sourceType && sourceType !== "inline") return null;
  if (!fileId && !designId) return null;
  if (typeof document === "undefined") return null;
  if (
    !Number.isFinite(canvasSize.width) ||
    !Number.isFinite(canvasSize.height) ||
    canvasSize.width < MIN_DIMENSION_PX ||
    canvasSize.height < MIN_DIMENSION_PX
  ) {
    return null;
  }

  const widthPx = Math.min(MAX_WIDTH_PX, Math.round(canvasSize.width));
  const heightPx = Math.min(MAX_HEIGHT_PX, Math.round(canvasSize.height));

  try {
    return await withTimeout(
      (async () => {
        const shot = await callAction<TakeDesignScreenshotResult>(
          "take-design-screenshot",
          {
            ...(fileId ? { fileId } : { designId, filename }),
            widths: [widthPx],
            heights: [heightPx],
          },
        );
        const screenshotUrl = shot?.ok ? shot.screenshots?.[0]?.url : undefined;
        if (!screenshotUrl) return null;

        const compositeDataUrl = await compositeScreenshotWithAnnotations(
          screenshotUrl,
          annotations,
          { width: widthPx, height: heightPx },
        );
        if (!compositeDataUrl) return null;

        const uploaded = await callAction<UploadImageResult>("upload-image", {
          data: compositeDataUrl,
          filename: `design-annotation-${designId ?? fileId}-${Date.now()}.png`,
        });
        return uploaded?.url ?? null;
      })(),
      CAPTURE_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn(
      "[DesignCanvas] annotated screenshot capture failed; falling back to text-only:",
      error,
    );
    return null;
  }
}
