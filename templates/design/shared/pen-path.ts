export interface PenPoint {
  x: number;
  y: number;
}

export interface PenNode {
  point: PenPoint;
  handleIn?: PenPoint;
  handleOut?: PenPoint;
}

export interface PenPath {
  nodes: PenNode[];
  closed: boolean;
}

export interface PenGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_PATH_SIZE = 12;

export function createCornerNode(point: PenPoint): PenNode {
  return { point: { ...point } };
}

/**
 * Creates a smooth (symmetric-handle) anchor by default: `handleIn` mirrors
 * `handleOut` across `anchor`, giving the anchor a continuous tangent on
 * both sides — this is what dragging a fresh pen anchor normally produces.
 *
 * Pass `{ breakSymmetry: true }` (Figma: hold Alt/Option while dragging a
 * newly placed anchor) to break that symmetry into a cusp: `handleOut`
 * still follows the drag, but no mirrored `handleIn` is created, so the
 * incoming segment stays a plain corner while the outgoing segment curves
 * independently.
 */
export function createSmoothNode(
  anchor: PenPoint,
  handleOut: PenPoint,
  options?: { breakSymmetry?: boolean },
): PenNode {
  return {
    point: { ...anchor },
    handleIn: options?.breakSymmetry
      ? undefined
      : mirrorPoint(anchor, handleOut),
    handleOut: { ...handleOut },
  };
}

export function appendPenNode(path: PenPath | null, node: PenNode): PenPath {
  return {
    nodes: [...(path?.nodes ?? []), clonePenNode(node)],
    closed: false,
  };
}

export function clonePenPath(path: PenPath): PenPath {
  return {
    nodes: path.nodes.map(clonePenNode),
    closed: path.closed,
  };
}

export function closePenPath(path: PenPath): PenPath {
  return {
    nodes: path.nodes.map(clonePenNode),
    closed: path.nodes.length > 1,
  };
}

export function constrainPointTo45Degrees(
  origin: PenPoint,
  point: PenPoint,
): PenPoint {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (dx === 0 && dy === 0) return { ...point };

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const axisX = Math.cos(snappedAngle);
  const axisY = Math.sin(snappedAngle);

  // Project the drag vector onto the snapped axis component-wise (like
  // Figma), rather than preserving the raw radial distance. For an
  // axis-aligned snap (0/90/180/270) this reduces to keeping the dominant
  // component and zeroing the other; for diagonal snaps it reduces to the
  // usual equal-magnitude diagonal.
  const projection = dx * axisX + dy * axisY;
  return {
    x: origin.x + axisX * projection,
    y: origin.y + axisY * projection,
  };
}

/**
 * Light pen-anchor snapping (P15): snap a candidate new-anchor point to any
 * existing anchor point of the path currently being drawn (Figma snaps new
 * anchors onto other anchors of the same path so you can precisely re-hit a
 * prior point), and otherwise round to the nearest integer canvas px once
 * the user is zoomed in to 100% or more (where sub-pixel placement is
 * rarely intentional and hairline anti-aliasing becomes visible).
 *
 * This intentionally does not snap to *other* shapes/frames on the canvas —
 * that's the existing computeMoveSnap/grid machinery's job for whole-object
 * moves, not a per-anchor pen concern.
 */
export function snapPenAnchorPoint(
  point: PenPoint,
  path: PenPath | null,
  options: { hitRadius: number; zoom: number },
): PenPoint {
  const existingAnchor = path?.nodes.find(
    (node) =>
      Math.hypot(node.point.x - point.x, node.point.y - point.y) <=
      options.hitRadius,
  );
  if (existingAnchor) {
    return { ...existingAnchor.point };
  }

  if (options.zoom >= 100) {
    return { x: Math.round(point.x), y: Math.round(point.y) };
  }

  return point;
}

export function isPenCloseTarget(
  path: PenPath | null,
  point: PenPoint,
  hitRadius: number,
) {
  const start = path?.nodes[0]?.point;
  if (!start || (path?.nodes.length ?? 0) < 2) return false;
  return Math.hypot(point.x - start.x, point.y - start.y) <= hitRadius;
}

export function getPenPathGeometry(path: PenPath): PenGeometry {
  if (path.nodes.length === 0) {
    return { x: 0, y: 0, width: MIN_PATH_SIZE, height: MIN_PATH_SIZE };
  }

  // Tight bounds: rather than bounding all anchors *and* control handles
  // (which over-counts — a handle that pulls a curve's tangent can sit well
  // outside the curve's actual extent), walk each rendered segment and
  // bound the real curve geometry: anchor endpoints plus any local extrema
  // found by solving the cubic Bezier derivative per axis. This matches
  // what `serializePenPath` actually draws (an `L` segment when handles
  // coincide with their anchors, otherwise a `C` segment).
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  const include = (point: PenPoint) => {
    if (point.x < left) left = point.x;
    if (point.x > right) right = point.x;
    if (point.y < top) top = point.y;
    if (point.y > bottom) bottom = point.y;
  };

  const { nodes, closed } = path;
  include(nodes[0].point);

  for (let i = 1; i < nodes.length; i++) {
    includeSegmentBounds(nodes[i - 1], nodes[i], include);
  }
  if (closed && nodes.length > 1) {
    includeSegmentBounds(nodes[nodes.length - 1], nodes[0], include);
  }

  if (!Number.isFinite(left)) {
    return { x: 0, y: 0, width: MIN_PATH_SIZE, height: MIN_PATH_SIZE };
  }

  const width = right - left;
  const height = bottom - top;
  // Degenerate (zero-area) paths — e.g. a single anchor, or a perfectly
  // straight horizontal/vertical two-point path — still need a visible
  // selection box, so floor to a minimum size in that case only.
  if (width <= 0 && height <= 0) {
    return { x: left, y: top, width: MIN_PATH_SIZE, height: MIN_PATH_SIZE };
  }
  return {
    x: left,
    y: top,
    width: width > 0 ? width : MIN_PATH_SIZE,
    height: height > 0 ? height : MIN_PATH_SIZE,
  };
}

function includeSegmentBounds(
  from: PenNode,
  to: PenNode,
  include: (point: PenPoint) => void,
) {
  const c1 = from.handleOut ?? from.point;
  const c2 = to.handleIn ?? to.point;
  include(to.point);

  // Straight segment (serializePenPath emits `L` in this case) — the two
  // anchors already bound it, no interior extrema to solve for.
  if (samePoint(c1, from.point) && samePoint(c2, to.point)) {
    return;
  }

  include(c1);
  include(c2);
  for (const t of cubicBezierExtremaTs(from.point.x, c1.x, c2.x, to.point.x)) {
    include({
      x: cubicBezierValue(from.point.x, c1.x, c2.x, to.point.x, t),
      y: cubicBezierValue(from.point.y, c1.y, c2.y, to.point.y, t),
    });
  }
  for (const t of cubicBezierExtremaTs(from.point.y, c1.y, c2.y, to.point.y)) {
    include({
      x: cubicBezierValue(from.point.x, c1.x, c2.x, to.point.x, t),
      y: cubicBezierValue(from.point.y, c1.y, c2.y, to.point.y, t),
    });
  }
}

/**
 * Roots of B'(t) = 0 for a single-axis cubic Bezier with control points
 * p0..p3, restricted to t in (0, 1) (endpoints are already included by the
 * caller via the anchor points).
 *
 * B(t) = (1-t)^3 p0 + 3(1-t)^2 t p1 + 3(1-t) t^2 p2 + t^3 p3
 * B'(t) = 3(1-t)^2 (p1-p0) + 6(1-t)t (p2-p1) + 3t^2 (p3-p2)
 *       = a t^2 + b t + c, with:
 *   a = 3 * (-p0 + 3p1 - 3p2 + p3)
 *   b = 6 * (p0 - 2p1 + p2)
 *   c = 3 * (p1 - p0)
 */
function cubicBezierExtremaTs(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number[] {
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);

  const roots: number[] = [];
  const EPS = 1e-9;

  if (Math.abs(a) < EPS) {
    // Linear derivative: at most one root.
    if (Math.abs(b) >= EPS) {
      const t = -c / b;
      if (t > 0 && t < 1) roots.push(t);
    }
    return roots;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return roots;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b + sqrtDisc) / (2 * a);
  const t2 = (-b - sqrtDisc) / (2 * a);
  if (t1 > 0 && t1 < 1) roots.push(t1);
  if (t2 > 0 && t2 < 1) roots.push(t2);
  return roots;
}

function cubicBezierValue(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

export function serializePenPath(path: PenPath): string {
  const [first, ...rest] = path.nodes;
  if (!first) return "";

  const commands = [`M ${formatPoint(first.point)}`];
  rest.forEach((node, index) => {
    const previous = path.nodes[index];
    commands.push(serializeSegment(previous, node));
  });

  if (path.closed && path.nodes.length > 1) {
    commands.push(serializeSegment(path.nodes[path.nodes.length - 1], first));
    commands.push("Z");
  }

  return commands.join(" ");
}

export function translatePenPath(
  path: PenPath,
  dx: number,
  dy: number,
): PenPath {
  return transformPenPath(path, (point) => ({
    x: point.x + dx,
    y: point.y + dy,
  }));
}

export function scalePenPathToGeometry(
  path: PenPath,
  origin: PenGeometry,
  next: PenGeometry,
): PenPath {
  const scaleX = next.width / Math.max(1, origin.width);
  const scaleY = next.height / Math.max(1, origin.height);
  return transformPenPath(path, (point) => ({
    x: next.x + (point.x - origin.x) * scaleX,
    y: next.y + (point.y - origin.y) * scaleY,
  }));
}

function serializeSegment(from: PenNode, to: PenNode) {
  const c1 = from.handleOut ?? from.point;
  const c2 = to.handleIn ?? to.point;
  if (samePoint(c1, from.point) && samePoint(c2, to.point)) {
    return `L ${formatPoint(to.point)}`;
  }
  return `C ${formatPoint(c1)} ${formatPoint(c2)} ${formatPoint(to.point)}`;
}

function transformPenPath(
  path: PenPath,
  transform: (point: PenPoint) => PenPoint,
): PenPath {
  return {
    nodes: path.nodes.map((node) => ({
      point: transform(node.point),
      handleIn: node.handleIn ? transform(node.handleIn) : undefined,
      handleOut: node.handleOut ? transform(node.handleOut) : undefined,
    })),
    closed: path.closed,
  };
}

function clonePenNode(node: PenNode): PenNode {
  return {
    point: { ...node.point },
    handleIn: node.handleIn ? { ...node.handleIn } : undefined,
    handleOut: node.handleOut ? { ...node.handleOut } : undefined,
  };
}

function mirrorPoint(anchor: PenPoint, point: PenPoint): PenPoint {
  return {
    x: anchor.x - (point.x - anchor.x),
    y: anchor.y - (point.y - anchor.y),
  };
}

function formatPoint(point: PenPoint) {
  return `${roundCoord(point.x)} ${roundCoord(point.y)}`;
}

function roundCoord(value: number) {
  return Math.round(value * 10) / 10;
}

function samePoint(a: PenPoint, b: PenPoint) {
  return a.x === b.x && a.y === b.y;
}

function isPenPoint(point: PenPoint | undefined): point is PenPoint {
  return !!point;
}
