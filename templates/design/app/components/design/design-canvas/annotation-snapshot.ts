import { callAction } from "@agent-native/core/client/hooks";

import type { DrawAnnotation } from "@/components/visual-editor";

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
  designId?: string;
  fileId?: string;
  filename?: string;
  sourceType?: "inline" | "localhost" | "fusion";
  annotations: DrawAnnotation[];
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

function parsePathDataPoints(
  pathData: string,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const match of pathData.matchAll(PATH_DATA_POINT_RE)) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

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

export async function captureAnnotatedScreenshot(
  options: CaptureAnnotatedScreenshotOptions,
): Promise<string | null> {
  const { designId, fileId, filename, sourceType, annotations, canvasSize } =
    options;

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
