import type { GradientLinePoint, Point } from "./types";

/**
 * The CSS `linear-gradient()` line-length formula (CSS Images ¤3
 * §linear-gradient-syntax): for a box of `width` x `height` and an angle
 * measured clockwise from "up" (matching both this app's `GradientValue`
 * angle convention and the CSS `<angle>` syntax `linear-gradient(Ndeg, ...)`
 * already produces), the gradient line's half-length from the box center is
 * `|width/2 * sin(angle)| + |height/2 * cos(angle)|` — the projection of the
 * box's half-diagonal onto the gradient axis, so the line exactly spans the
 * box from edge to edge (touching whichever corner is furthest along the
 * axis) the same way a browser renders it.
 */
export function gradientLineEndpoints(
  angleDeg: number,
  width: number,
  height: number,
): { start: Point; end: Point } {
  const rad = (angleDeg * Math.PI) / 180;
  // Unit vector pointing from the gradient's start toward its end (0deg = up
  // = -y, clockwise), matching AngleDial's "0 is north, clockwise" mapping.
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const halfLength = Math.abs((width / 2) * dx) + Math.abs((height / 2) * dy);
  const center = { x: width / 2, y: height / 2 };
  return {
    start: { x: center.x - dx * halfLength, y: center.y - dy * halfLength },
    end: { x: center.x + dx * halfLength, y: center.y + dy * halfLength },
  };
}

/** Projects each stop's 0–100 `position` onto the gradient line's start/end
 *  points (linear interpolation), for rendering a round marker per stop. */
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

/**
 * Inverts a dragged endpoint handle back into an angle: given the box center
 * and the new local point for whichever endpoint is being dragged (`which`),
 * returns the angle (0-360, "up"-is-0 clockwise) whose gradient line passes
 * through that point. Dragging the "start" handle points the axis the
 * opposite way (the start is the *far* end of the line from that point's
 * direction), so it adds 180° after resolving the raw pointer angle.
 */
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
  // atan2 gives angle from east (+x), clockwise-positive in screen space
  // (y-down); convert to this app's "0 is north, clockwise" convention by
  // rotating the reference axis by +90deg, matching AngleDial's own mapping.
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (which === "start") deg += 180;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

/**
 * Inverts a dragged stop marker back into a 0–100 position: projects the
 * dragged local point onto the (unbounded) gradient line through the box
 * center at `angleDeg`, using the *current* line's start/end as the 0/100
 * reference frame, then clamps to [0, 100]. This mirrors
 * `GradientEditor`'s own `positionFromPointer`, which likewise projects the
 * pointer onto the ramp bar's axis and clamps rather than rejecting
 * off-axis drags — on canvas the equivalent "axis" is the gradient line
 * itself, so a drag that strays perpendicular to the line still tracks the
 * nearest point on it instead of doing nothing.
 */
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

/** Converts a constant on-screen pixel radius (e.g. a hit-test tolerance
 *  that should feel the same size regardless of zoom) into canvas px, the
 *  space hitTestPenAnchor/hitTestPenHandle and PenPath geometry operate in.
 *  `zoom` is the same 0-based-at-100 percentage used throughout this file
 *  (100 = 1:1). Mirrors the `screenPx / (zoom / 100)` conversion already
 *  used by the pen tool's close-hit-target radius. */
export function screenPxToCanvasPx(screenPx: number, zoom: number): number {
  const scale = zoom / 100;
  return scale > 0 ? screenPx / scale : screenPx;
}
