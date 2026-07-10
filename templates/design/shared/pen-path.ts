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
  // Nearest anchor within radius wins (matching hitTestPenAnchor), not the
  // first one found in node order — two anchors can easily both sit within
  // the hit radius (e.g. a tightly drawn shape), and a "first match" scan
  // would snap to whichever happens to have the lower node index rather than
  // the one actually closest to the cursor.
  let nearestAnchor: PenPoint | null = null;
  let nearestDistance = Infinity;
  for (const node of path?.nodes ?? []) {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y);
    if (distance <= options.hitRadius && distance < nearestDistance) {
      nearestDistance = distance;
      nearestAnchor = node.point;
    }
  }
  if (nearestAnchor) {
    return { ...nearestAnchor };
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

/**
 * Compact, lossless, attribute-safe encoding of a full structured `PenPath`
 * (every node's anchor point, handleIn, handleOut, and the path's `closed`
 * flag) — for stashing on a committed screen element (e.g.
 * `data-an-pen-nodes="..."`) so the flattened `<path d="...">` baked by
 * `serializePenPath` can later be re-hydrated into an editable vector path
 * for vector edit mode.
 *
 * Format: `JSON.stringify([closedFlag, ...nodeTuples])` where each node
 * tuple is `[px, py, hix, hiy, hox, hoy]` and a missing handle is encoded as
 * `null` for both of its coordinates. This is plain JSON (no raw `"`, `<`,
 * `>`, or `&`), so it round-trips safely through `Element.setAttribute` /
 * `getAttribute` without any additional escaping, and stays compact because
 * every node is a flat numeric array rather than an object with repeated
 * key names.
 */
export function serializePenNodes(path: PenPath): string {
  const tuples: PenNodeTuple[] = path.nodes.map((node) => [
    node.point.x,
    node.point.y,
    node.handleIn ? node.handleIn.x : null,
    node.handleIn ? node.handleIn.y : null,
    node.handleOut ? node.handleOut.x : null,
    node.handleOut ? node.handleOut.y : null,
  ]);
  return JSON.stringify([path.closed ? 1 : 0, ...tuples]);
}

/**
 * Inverse of `serializePenNodes`. Returns `null` (never throws) for any
 * malformed, truncated, or otherwise unrecognized input, so callers can
 * safely attempt to parse arbitrary/untrusted attribute strings read back
 * off the DOM.
 */
export function parsePenNodes(serialized: string): PenPath | null {
  if (typeof serialized !== "string" || serialized.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const [closedFlag, ...tuples] = parsed;
  if (closedFlag !== 0 && closedFlag !== 1) return null;

  const nodes: PenNode[] = [];
  for (const tuple of tuples) {
    const node = parsePenNodeTuple(tuple);
    if (!node) return null;
    nodes.push(node);
  }

  return { nodes, closed: closedFlag === 1 };
}

function parsePenNodeTuple(tuple: unknown): PenNode | null {
  if (!Array.isArray(tuple) || tuple.length !== 6) return null;
  const [px, py, hix, hiy, hox, hoy] = tuple;
  if (!isFiniteNumber(px) || !isFiniteNumber(py)) return null;
  if (!isNullOrFiniteNumber(hix) || !isNullOrFiniteNumber(hiy)) return null;
  if (!isNullOrFiniteNumber(hox) || !isNullOrFiniteNumber(hoy)) return null;
  // A handle's two coordinates must agree on presence — one present and the
  // other null is not a representable PenPoint.
  if ((hix === null) !== (hiy === null)) return null;
  if ((hox === null) !== (hoy === null)) return null;

  return {
    point: { x: px, y: py },
    handleIn: hix === null || hiy === null ? undefined : { x: hix, y: hiy },
    handleOut: hox === null || hoy === null ? undefined : { x: hox, y: hoy },
  };
}

type PenNodeTuple = [
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullOrFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

/**
 * Nearest pen anchor to `point` within `radiusInCanvasPx`, or `null` if none
 * qualifies. Ties (equal distance) resolve to the earlier node index, same
 * as a stable nearest-match scan.
 */
export function hitTestPenAnchor(
  path: PenPath,
  point: PenPoint,
  radiusInCanvasPx: number,
): { nodeIndex: number } | null {
  let bestIndex = -1;
  let bestDistance = Infinity;

  path.nodes.forEach((node, index) => {
    const distance = Math.hypot(node.point.x - point.x, node.point.y - point.y);
    if (distance <= radiusInCanvasPx && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex === -1 ? null : { nodeIndex: bestIndex };
}

/**
 * Nearest pen control-handle endpoint (a node's `handleIn` or `handleOut`)
 * to `point` within `radiusInCanvasPx`, or `null` if none qualifies. Nodes
 * without a given handle are skipped for that handle.
 */
export function hitTestPenHandle(
  path: PenPath,
  point: PenPoint,
  radiusInCanvasPx: number,
): { nodeIndex: number; which: "in" | "out" } | null {
  let bestIndex = -1;
  let bestWhich: "in" | "out" = "in";
  let bestDistance = Infinity;

  path.nodes.forEach((node, index) => {
    (["in", "out"] as const).forEach((which) => {
      const handle = which === "in" ? node.handleIn : node.handleOut;
      if (!handle) return;
      const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
      if (distance <= radiusInCanvasPx && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
        bestWhich = which;
      }
    });
  });

  return bestIndex === -1 ? null : { nodeIndex: bestIndex, which: bestWhich };
}

/**
 * Returns a new path with the anchor at `nodeIndex` moved to `newPoint`.
 * By default its `handleIn`/`handleOut` translate along with it (Figma:
 * dragging an anchor keeps both handles' offsets from the anchor fixed).
 * Pass `{ moveHandlesWithAnchor: false }` to move only the anchor point and
 * leave both handles at their existing absolute positions. Never mutates
 * `path`.
 */
export function movePenAnchor(
  path: PenPath,
  nodeIndex: number,
  newPoint: PenPoint,
  options?: { moveHandlesWithAnchor?: boolean },
): PenPath {
  if (!isValidNodeIndex(path, nodeIndex)) return clonePenPath(path);

  const moveHandles = options?.moveHandlesWithAnchor ?? true;
  const node = path.nodes[nodeIndex];
  const dx = newPoint.x - node.point.x;
  const dy = newPoint.y - node.point.y;

  const nextNode: PenNode = {
    point: { ...newPoint },
    handleIn: node.handleIn
      ? moveHandles
        ? { x: node.handleIn.x + dx, y: node.handleIn.y + dy }
        : { ...node.handleIn }
      : undefined,
    handleOut: node.handleOut
      ? moveHandles
        ? { x: node.handleOut.x + dx, y: node.handleOut.y + dy }
        : { ...node.handleOut }
      : undefined,
  };

  return replaceNode(path, nodeIndex, nextNode);
}

/**
 * Returns a new path with the `which` control handle of the node at
 * `nodeIndex` moved to `newHandlePoint`. For a smooth node (one whose
 * *opposite* handle already exists), the opposite handle mirrors the drag
 * by default — the anchor stays the midpoint between both handles, so the
 * tangent stays continuous (Figma default). Pass `{ breakSymmetry: true }`
 * to move only the dragged handle, leaving the opposite handle where it
 * was; this turns the anchor into a cusp going forward. A node with no
 * opposite handle (a cusp already, or a plain corner gaining its first
 * handle) never gains one as a side effect of this call — only the
 * requested handle is created/moved. Never mutates `path`.
 */
export function movePenHandle(
  path: PenPath,
  nodeIndex: number,
  which: "in" | "out",
  newHandlePoint: PenPoint,
  options?: { breakSymmetry?: boolean },
): PenPath {
  if (!isValidNodeIndex(path, nodeIndex)) return clonePenPath(path);

  const node = path.nodes[nodeIndex];
  const oppositeKey = which === "in" ? "handleOut" : "handleIn";
  const draggedKey = which === "in" ? "handleIn" : "handleOut";
  const hasOpposite = !!node[oppositeKey];

  const nextNode: PenNode = { ...clonePenNode(node) };
  nextNode[draggedKey] = { ...newHandlePoint };

  if (hasOpposite && !options?.breakSymmetry) {
    nextNode[oppositeKey] = mirrorPoint(node.point, newHandlePoint);
  }

  return replaceNode(path, nodeIndex, nextNode);
}

/**
 * Returns a new path with the node at `nodeIndex` converted to `type`.
 * Converting to `"corner"` drops both handles (a corner anchor has none).
 * Converting to `"smooth"` synthesizes symmetric handles from the
 * neighboring anchors when the node doesn't already have at least one
 * handle — reusing the same mirrored-handle shape `createSmoothNode`
 * produces — so the anchor gets a continuous tangent through its
 * neighbors. A node that already has a handleIn or handleOut is left as-is
 * aside from ensuring both sides are populated and mirrored, since it's
 * already effectively smooth. Never mutates `path`.
 */
export function setPenNodeType(
  path: PenPath,
  nodeIndex: number,
  type: "corner" | "smooth",
): PenPath {
  if (!isValidNodeIndex(path, nodeIndex)) return clonePenPath(path);

  const node = path.nodes[nodeIndex];

  if (type === "corner") {
    return replaceNode(path, nodeIndex, { point: { ...node.point } });
  }

  if (node.handleIn || node.handleOut) {
    // Already has at least one handle: treat as smooth already, but make
    // sure both sides are present and mirrored around the anchor so the
    // tangent is continuous on both sides.
    const source = node.handleOut ?? node.handleIn!;
    const handleOut = node.handleOut ?? mirrorPoint(node.point, source);
    const handleIn = node.handleIn ?? mirrorPoint(node.point, handleOut);
    return replaceNode(path, nodeIndex, {
      point: { ...node.point },
      handleIn: { ...handleIn },
      handleOut: { ...handleOut },
    });
  }

  // Plain corner with no handles yet: synthesize a symmetric handle pair
  // from the neighboring anchors so the new tangent follows the path's
  // local direction, matching what a freshly-dragged smooth anchor looks
  // like via createSmoothNode.
  const neighbor =
    path.nodes[nodeIndex + 1] ??
    path.nodes[nodeIndex - 1] ??
    (path.closed ? path.nodes[0] : undefined);
  const direction = neighbor
    ? { x: neighbor.point.x - node.point.x, y: neighbor.point.y - node.point.y }
    : { x: 1, y: 0 };
  // Scale the synthesized handle to a small fraction of the distance to the
  // neighbor (rather than reaching all the way to it), matching the usual
  // proportions of a Figma smooth-anchor handle.
  const HANDLE_FRACTION = 1 / 3;
  const handleOut = {
    x: node.point.x + direction.x * HANDLE_FRACTION,
    y: node.point.y + direction.y * HANDLE_FRACTION,
  };

  return replaceNode(path, nodeIndex, createSmoothNode(node.point, handleOut));
}

function isValidNodeIndex(path: PenPath, nodeIndex: number): boolean {
  return (
    Number.isInteger(nodeIndex) &&
    nodeIndex >= 0 &&
    nodeIndex < path.nodes.length
  );
}

function replaceNode(path: PenPath, nodeIndex: number, node: PenNode): PenPath {
  const nodes = path.nodes.map(clonePenNode);
  nodes[nodeIndex] = clonePenNode(node);
  return { nodes, closed: path.closed };
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
