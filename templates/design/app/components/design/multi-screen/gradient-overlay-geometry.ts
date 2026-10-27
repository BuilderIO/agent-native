import type { GradientLinePoint, Point } from "./types";

export function gradientLineEndpoints(
  angleDeg: number,
  width: number,
  height: number,
): { start: Point; end: Point } {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const halfLength = Math.abs((width / 2) * dx) + Math.abs((height / 2) * dy);
  const center = { x: width / 2, y: height / 2 };
  return {
    start: { x: center.x - dx * halfLength, y: center.y - dy * halfLength },
    end: { x: center.x + dx * halfLength, y: center.y + dy * halfLength },
  };
}

export function gradientStopPoints(
  angleDeg: number,
  width: number,
  height: number,
  stops: ReadonlyArray<{ position: number }>,
): GradientLinePoint[] {
  const { start, end } = gradientLineEndpoints(angleDeg, width, height);
  return stops.map((stop) => {
    const t = clampGradientT(stop.position / 100);
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      position: stop.position,
    };
  });
}

function clampGradientT(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, t));
}

export function angleFromDraggedEndpoint(
  point: Point,
  width: number,
  height: number,
  which: "start" | "end",
): number {
  const center = { x: width / 2, y: height / 2 };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (dx === 0 && dy === 0) return 0;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (which === "start") deg += 180;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

export function stopPercentFromDraggedPoint(
  point: Point,
  angleDeg: number,
  width: number,
  height: number,
): number {
  const { start, end } = gradientLineEndpoints(angleDeg, width, height);
  const lineDx = end.x - start.x;
  const lineDy = end.y - start.y;
  const lengthSquared = lineDx * lineDx + lineDy * lineDy;
  if (lengthSquared === 0) return 0;
  const t =
    ((point.x - start.x) * lineDx + (point.y - start.y) * lineDy) /
    lengthSquared;
  return clampGradientT(t) * 100;
}

export function screenPxToCanvasPx(screenPx: number, zoom: number): number {
  const scale = zoom / 100;
  return scale > 0 ? screenPx / scale : screenPx;
}
