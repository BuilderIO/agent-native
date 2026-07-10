/**
 * Editor-chrome overlays that editor-chrome.bridge.ts appends inside the preview
 * iframe (the selection outline + resize handles, hover highlight, marquee,
 * spacing/measurement guides, and badges). They live in the iframe DOM, so image
 * exports must strip them from the clone — otherwise a download captures the
 * editor's selection outline instead of just the design. Keep this in sync with
 * the data-agent-native-* markers set in editor-chrome.bridge.ts.
 */
export const EDITOR_CHROME_OVERLAY_SELECTOR = [
  "[data-agent-native-edit-overlay]",
  "[data-agent-native-edit-handle]",
  "[data-agent-native-edge-handle]",
  "[data-agent-native-rotate-handle]",
  "[data-agent-native-transform-badge]",
  "[data-agent-native-spacing-badge]",
  "[data-agent-native-spacing-overlay]",
  "[data-agent-native-spacing-line]",
  "[data-agent-native-spacing-region]",
  "[data-agent-native-insertion-guide]",
  "[data-agent-native-measurement-overlay]",
].join(",");

export interface ExportCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Return the smallest document-space rectangle containing every valid item. */
export function unionExportCropRects(
  rects: readonly ExportCropRect[],
): ExportCropRect | null {
  const valid = rects.filter(
    (rect) =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0,
  );
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map((rect) => rect.x));
  const top = Math.min(...valid.map((rect) => rect.y));
  const right = Math.max(...valid.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...valid.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface ExportCompositeFrame extends ExportCropRect {
  rotation?: number;
}

/**
 * Resolve the world-space bounds of selected screen frames, including rotation,
 * so a multi-frame clipboard image preserves the same spacing as the canvas.
 */
export function getExportCompositeBounds(
  frames: readonly ExportCompositeFrame[],
): ExportCropRect | null {
  return unionExportCropRects(
    frames.flatMap((frame) => {
      if (frame.width <= 0 || frame.height <= 0) return [];
      const radians = ((frame.rotation ?? 0) * Math.PI) / 180;
      if (radians === 0) return [frame];
      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y + frame.height / 2;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const corners = [
        [-frame.width / 2, -frame.height / 2],
        [frame.width / 2, -frame.height / 2],
        [frame.width / 2, frame.height / 2],
        [-frame.width / 2, frame.height / 2],
      ].map(([x, y]) => ({
        x: centerX + x * cosine - y * sine,
        y: centerY + x * sine + y * cosine,
      }));
      const left = Math.min(...corners.map((corner) => corner.x));
      const top = Math.min(...corners.map((corner) => corner.y));
      const right = Math.max(...corners.map((corner) => corner.x));
      const bottom = Math.max(...corners.map((corner) => corner.y));
      return [{ x: left, y: top, width: right - left, height: bottom - top }];
    }),
  );
}

/**
 * Map a document-space rect onto pixel coordinates within a rendered canvas of
 * the given size, clamped to stay inside the canvas. `scale` must match the
 * scale passed to html2canvas. Returns null when the crop would be empty or
 * lands fully outside the canvas, so callers can fall back to the full render.
 */
export function computeExportCropBox(
  sourceWidth: number,
  sourceHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const right = Math.min(
    sourceWidth,
    Math.round((rect.x + rect.width) * scale),
  );
  const bottom = Math.min(
    sourceHeight,
    Math.round((rect.y + rect.height) * scale),
  );
  const sw = right - sx;
  const sh = bottom - sy;
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}
