import type { ElementInfo } from "../types";
import { isLineElement } from "./element-classification";

export interface LineGeometry {
  /** CSS px from the start point to the end point, before the layer's rotation. */
  dx: number;
  dy: number;
  length: number;
  /** Degrees, counter-clockwise positive, matching the Rotation field. */
  angle: number;
}

const SEGMENT_PATH =
  /<path\b[^>]*\sd="\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*"/i;

function pxLength(value: string | undefined): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * A drawn line is an SVG box stretched over one M…L segment, so the box size
 * gives the segment's extent and the path gives its direction.
 */
export function lineGeometryForElement(
  element: ElementInfo,
): LineGeometry | null {
  if (!isLineElement(element) || !element.htmlContent) return null;
  // Endpoint markers live in <defs> and carry paths of their own.
  const markup = element.htmlContent.replace(/<defs\b[\s\S]*?<\/defs>/gi, "");
  const match = SEGMENT_PATH.exec(markup);
  const width = pxLength(element.computedStyles.width);
  const height = pxLength(element.computedStyles.height);
  if (!match || width === null || height === null) return null;
  const [x1, y1, x2, y2] = match.slice(1, 5).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const dx = Math.sign(x2 - x1) * width;
  const dy = Math.sign(y2 - y1) * height;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return null;
  const angle = (-Math.atan2(dy, dx) * 180) / Math.PI;
  return { dx, dy, length, angle: Object.is(angle, -0) ? 0 : angle };
}

/** The box size that gives the line `length` along its current direction. */
export function lineLengthSizes(
  line: LineGeometry,
  length: number,
): { horizontal?: number; vertical?: number } {
  const scale = Math.max(0, length) / line.length;
  return {
    ...(line.dx !== 0 ? { horizontal: Math.abs(line.dx) * scale } : {}),
    ...(line.dy !== 0 ? { vertical: Math.abs(line.dy) * scale } : {}),
  };
}
