import type { Point } from "./types.js";

const OUT_STUB = 28;
const IN_STUB = 28;
const DROP = 56;
const LANE_GAP = 18;
const CORNER_RADIUS = 12;

/** A polyline through `points` with each interior corner rounded by up to `radius`. */
export function roundedPolyline(points: readonly Point[], radius: number) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const before = points[i - 1];
    const corner = points[i];
    const after = points[i + 1];
    const inLength = Math.hypot(corner.x - before.x, corner.y - before.y);
    const outLength = Math.hypot(after.x - corner.x, after.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r === 0) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const enter = {
      x: corner.x + ((before.x - corner.x) / inLength) * r,
      y: corner.y + ((before.y - corner.y) / inLength) * r,
    };
    const leave = {
      x: corner.x + ((after.x - corner.x) / outLength) * r,
      y: corner.y + ((after.y - corner.y) / outLength) * r,
    };
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

/**
 * The U-detour a loop's back-edge draws: out of the source, down below every
 * node it spans, back along the bottom, and up into the target. `bottom` is
 * the lowest edge of the nodes involved; `lane` staggers loops that share a
 * span so their lines do not sit on top of each other.
 */
export function backEdgeGeometry(args: {
  source: Point;
  target: Point;
  bottom: number;
  lane?: number;
}) {
  const { source, target } = args;
  const floor =
    Math.max(args.bottom, source.y, target.y) +
    DROP +
    (args.lane ?? 0) * LANE_GAP;
  const outX = source.x + OUT_STUB;
  const inX = target.x - IN_STUB;
  const points: Point[] = [
    source,
    { x: outX, y: source.y },
    { x: outX, y: floor },
    { x: inX, y: floor },
    { x: inX, y: target.y },
    target,
  ];
  return {
    path: roundedPolyline(points, CORNER_RADIUS),
    labelX: (outX + inX) / 2,
    labelY: floor,
  };
}
