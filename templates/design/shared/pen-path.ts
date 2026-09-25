export interface PenPoint {
  x: number;
  y: number;
}

export interface PenNode {
  point: PenPoint;
  handleIn?: PenPoint;
  handleOut?: PenPoint;
  /** Figma's per-vertex corner radius; overrides the vector's own radius. */
  cornerRadius?: number;
  /** Figma's handle mirroring once the user picks one; else read off the handles. */
  mirroring?: PenMirroring;
}

function copyVertexMeta(from: PenNode, to: PenNode): PenNode {
  if (from.cornerRadius !== undefined) to.cornerRadius = from.cornerRadius;
  if (from.mirroring !== undefined) to.mirroring = from.mirroring;
  return to;
}

export interface PenPath {
  nodes: PenNode[];
  closed: boolean;
}

export function penCornerRadiusFromAttribute(
  value: string | null | undefined,
): number {
  const radius = Number(value);
  return value != null && Number.isFinite(radius) && radius > 0 ? radius : 0;
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

/**
 * Per-drag memory for Figma's Alt-breaks-the-handle-pair gesture on a new pen
 * anchor. Owned by the drag state, not by a single move event.
 */
export interface PenCuspLatch {
  broken: boolean;
  handleIn?: PenPoint;
}

export function createPenCuspLatch(): PenCuspLatch {
  return { broken: false };
}

/**
 * Builds the anchor a new-anchor drag is currently describing.
 *
 * Alt is a one-way latch for the life of the drag: releasing it does not
 * re-mirror the pair, and breaking it freezes `handleIn` at the tangent it
 * had when Alt went down rather than deleting it, so the segment already
 * drawn keeps its curve. Alt held from the first tick has no earlier tangent
 * to keep, leaving the incoming side a corner.
 */
export function createPenDragNode(
  anchor: PenPoint,
  handleOut: PenPoint,
  latch: PenCuspLatch,
  altKey: boolean,
): PenNode {
  if (altKey) latch.broken = true;
  if (!latch.broken) latch.handleIn = mirrorPoint(anchor, handleOut);
  return {
    point: { ...anchor },
    handleIn: latch.handleIn ? { ...latch.handleIn } : undefined,
    handleOut: { ...handleOut },
  };
}

export function appendPenNode(path: PenPath | null, node: PenNode): PenPath {
  return {
    nodes: [...(path?.nodes ?? []), clonePenNode(node)],
    closed: false,
  };
}

export function resumePenPathAtEnd(
  path: PenPath,
  point: PenPoint,
  hitRadius: number,
): PenPath | null {
  if (path.closed || path.nodes.length < 2) return null;
  const end = path.nodes[path.nodes.length - 1];
  if (
    !end ||
    Math.hypot(end.point.x - point.x, end.point.y - point.y) > hitRadius
  ) {
    return null;
  }
  return clonePenPath(path);
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

/**
 * The open path to keep drawing from when the pen clicks one of its
 * endpoints, oriented so that endpoint is last; `null` for a closed path or
 * a click on neither end.
 */
export function continuePenPathFromEndpoint(
  path: PenPath,
  point: PenPoint,
  hitRadius: number,
): PenPath | null {
  if (path.closed || path.nodes.length < 2) return null;
  const hit = hitTestPenAnchor(path, point, hitRadius);
  if (hit?.nodeIndex === path.nodes.length - 1) return clonePenPath(path);
  if (hit?.nodeIndex !== 0) return null;
  return {
    closed: false,
    nodes: path.nodes
      .map((node) => ({
        ...clonePenNode(node),
        handleIn: node.handleOut ? { ...node.handleOut } : undefined,
        handleOut: node.handleIn ? { ...node.handleIn } : undefined,
      }))
      .reverse(),
  };
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
 * tuple is `[px, py, hix, hiy, hox, hoy, radius]`; missing handles and
 * radii are encoded as `null` for both handle coordinates / the radius. This is plain JSON (no raw `"`, `<`,
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
    node.cornerRadius ?? null,
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

  const path = { nodes, closed: closedFlag === 1 };
  if (
    nodes.some(
      (node, index) =>
        node.cornerRadius !== undefined &&
        node.cornerRadius > 0 &&
        maxPenCornerRadius(path, index) === null,
    )
  )
    return null;
  return path;
}

function parsePenNodeTuple(tuple: unknown): PenNode | null {
  if (!Array.isArray(tuple) || (tuple.length !== 6 && tuple.length !== 7)) {
    return null;
  }
  const [px, py, hix, hiy, hox, hoy, radius] = tuple;
  if (radius !== undefined && radius !== null && !isFiniteNumber(radius))
    return null;
  if (typeof radius === "number" && radius < 0) return null;
  const radiusValid = typeof radius === "number";
  if (!isFiniteNumber(px) || !isFiniteNumber(py)) return null;
  if (!isNullOrFiniteNumber(hix) || !isNullOrFiniteNumber(hiy)) return null;
  if (!isNullOrFiniteNumber(hox) || !isNullOrFiniteNumber(hoy)) return null;
  // A handle's two coordinates must agree on presence — one present and the
  // other null is not a representable PenPoint.
  if ((hix === null) !== (hiy === null)) return null;
  if ((hox === null) !== (hoy === null)) return null;

  const node: PenNode = {
    point: { x: px, y: py },
    handleIn: hix === null || hiy === null ? undefined : { x: hix, y: hiy },
    handleOut: hox === null || hoy === null ? undefined : { x: hox, y: hoy },
  };
  if (radiusValid) node.cornerRadius = radius as number;
  return node;
}

type PenNodeTuple = [
  number,
  number,
  number | null,
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

  copyVertexMeta(node, nextNode);
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

  const mirroring = penNodeMirroring(node);
  if (hasOpposite && !options?.breakSymmetry && mirroring !== "none") {
    nextNode[oppositeKey] =
      mirroring === "angleAndLength"
        ? mirrorPoint(node.point, newHandlePoint)
        : opposeAtLength(node.point, newHandlePoint, node[oppositeKey]!);
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
    return replaceNode(
      path,
      nodeIndex,
      copyVertexMeta(node, { point: { ...node.point } }),
    );
  }

  if (node.handleIn || node.handleOut) {
    // Already has at least one handle: treat as smooth already, but make
    // sure both sides are present and mirrored around the anchor so the
    // tangent is continuous on both sides.
    const source = node.handleOut ?? node.handleIn!;
    const handleOut = node.handleOut ?? mirrorPoint(node.point, source);
    const handleIn = node.handleIn ?? mirrorPoint(node.point, handleOut);
    return replaceNode(
      path,
      nodeIndex,
      copyVertexMeta(node, {
        point: { ...node.point },
        handleIn: { ...handleIn },
        handleOut: { ...handleOut },
      }),
    );
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

export type PenMirroring = "none" | "angle" | "angleAndLength";

/** Figma's handle mirroring for a vertex, read from its handle geometry. */
export function penNodeMirroring(node: PenNode): PenMirroring {
  if (node.mirroring) return node.mirroring;
  if (!node.handleIn || !node.handleOut) return "none";
  const vin = {
    x: node.handleIn.x - node.point.x,
    y: node.handleIn.y - node.point.y,
  };
  const vout = {
    x: node.handleOut.x - node.point.x,
    y: node.handleOut.y - node.point.y,
  };
  const scale = Math.max(Math.hypot(vin.x, vin.y), Math.hypot(vout.x, vout.y));
  if (scale === 0) return "none";
  // Saved paths round to 0.1px, so an exact mirror can come back a hair off.
  const tolerance = scale * 1e-2;
  if (Math.hypot(vin.x + vout.x, vin.y + vout.y) <= tolerance) {
    return "angleAndLength";
  }
  const collinear =
    Math.abs(vin.x * vout.y - vin.y * vout.x) <= tolerance * scale &&
    vin.x * vout.x + vin.y * vout.y < 0;
  return collinear ? "angle" : "none";
}

/**
 * Stores a vertex's mirroring mode and, for the mirrored modes, re-aims its
 * incoming handle off the outgoing one; a corner gains a smooth pair first.
 */
export function setPenNodeMirroring(
  path: PenPath,
  nodeIndex: number,
  mirroring: PenMirroring,
): PenPath {
  if (!isValidNodeIndex(path, nodeIndex)) return clonePenPath(path);
  const node = path.nodes[nodeIndex]!;
  const base =
    mirroring !== "none" && !node.handleIn && !node.handleOut
      ? setPenNodeType(path, nodeIndex, "smooth").nodes[nodeIndex]!
      : node;
  const next = clonePenNode(base);
  next.mirroring = mirroring;
  if (mirroring !== "none") {
    const lead = base.handleOut ?? mirrorPoint(base.point, base.handleIn!);
    next.handleOut = { ...lead };
    next.handleIn =
      mirroring === "angleAndLength" || !base.handleIn
        ? mirrorPoint(base.point, lead)
        : opposeAtLength(base.point, lead, base.handleIn);
  }
  return replaceNode(path, nodeIndex, next);
}

/** `current`'s length, pointing directly away from `lead` across `anchor`. */
function opposeAtLength(
  anchor: PenPoint,
  lead: PenPoint,
  current: PenPoint,
): PenPoint {
  const length = Math.hypot(current.x - anchor.x, current.y - anchor.y);
  const dx = lead.x - anchor.x;
  const dy = lead.y - anchor.y;
  const leadLength = Math.hypot(dx, dy);
  if (leadLength === 0) return { ...current };
  return {
    x: anchor.x - (dx / leadLength) * length,
    y: anchor.y - (dy / leadLength) * length,
  };
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
  const first = path.nodes[0];
  if (!first) return "";

  const commands = roundedPenCommands(path);
  if (path.closed && path.nodes.length > 1) commands.push("Z");

  return commands.join(" ");
}

function roundedPenCommands(path: PenPath): string[] {
  const { nodes, closed } = path;
  const count = nodes.length;
  const rounded = nodes.map((node, index) => {
    const radius = node.cornerRadius ?? 0;
    if (radius <= 0) return null;
    const maximum = maxPenCornerRadius(path, index);
    if (maximum === null) return null;
    const previous = nodes[index > 0 ? index - 1 : count - 1]!;
    const next = nodes[index < count - 1 ? index + 1 : 0]!;
    const incoming = {
      x: previous.point.x - node.point.x,
      y: previous.point.y - node.point.y,
    };
    const outgoing = {
      x: next.point.x - node.point.x,
      y: next.point.y - node.point.y,
    };
    const inLength = Math.hypot(incoming.x, incoming.y);
    const outLength = Math.hypot(outgoing.x, outgoing.y);
    const cosine = Math.max(
      -1,
      Math.min(
        1,
        (incoming.x * outgoing.x + incoming.y * outgoing.y) /
          (inLength * outLength),
      ),
    );
    if (cosine <= -0.9999999 || cosine >= 0.9999999) return null;
    const tangent = Math.tan(Math.acos(cosine) / 2);
    const actualRadius = Math.min(radius, maximum);
    const trim = actualRadius / tangent;
    return {
      entry: {
        x: node.point.x + (incoming.x / inLength) * trim,
        y: node.point.y + (incoming.y / inLength) * trim,
      },
      exit: {
        x: node.point.x + (outgoing.x / outLength) * trim,
        y: node.point.y + (outgoing.y / outLength) * trim,
      },
      radius: actualRadius,
      sweep: incoming.x * outgoing.y - incoming.y * outgoing.x < 0 ? 1 : 0,
    };
  });
  const commands = [`M ${formatPoint(rounded[0]?.exit ?? nodes[0]!.point)}`];
  for (let index = 1; index < count; index++) {
    const node = nodes[index]!;
    const corner = rounded[index];
    commands.push(
      corner
        ? `L ${formatPoint(corner.entry)}`
        : serializeSegment(nodes[index - 1]!, node),
    );
    if (corner)
      commands.push(
        `A ${roundCoord(corner.radius)} ${roundCoord(corner.radius)} 0 0 ${corner.sweep} ${formatPoint(corner.exit)}`,
      );
  }
  if (closed && count > 1) {
    const firstCorner = rounded[0];
    if (firstCorner) {
      commands.push(`L ${formatPoint(firstCorner.entry)}`);
      commands.push(
        `A ${roundCoord(firstCorner.radius)} ${roundCoord(firstCorner.radius)} 0 0 ${firstCorner.sweep} ${formatPoint(firstCorner.exit)}`,
      );
    } else {
      commands.push(serializeSegment(nodes[count - 1]!, nodes[0]!));
    }
  }
  return commands;
}

/**
 * `serializePenPath` with each corner rounded by an arc of `radius` (a vertex's
 * own `cornerRadius` wins), clamped to half the shorter neighbouring chord.
 */
export function serializeRoundedPenPath(
  path: PenPath,
  radius: number,
  decimals = 1,
): string {
  const { nodes, closed } = path;
  const radiusAt = (node: PenNode) => node.cornerRadius ?? radius;
  if (nodes.length < 3 || !nodes.some((node) => radiusAt(node) > 0)) {
    return serializePenPath(path);
  }
  const count = nodes.length;
  const segmentCount = closed ? count : count - 1;
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    controls: segmentControls(path, index),
    straight: isStraightSegment(path, index),
    tStart: 0,
    tEnd: 1,
  }));
  const incomingOf = (index: number) =>
    index > 0 ? index - 1 : closed ? count - 1 : -1;
  const outgoingOf = (index: number) => (index < segmentCount ? index : -1);
  const geometry = nodes.map((node, index) => {
    const incoming = incomingOf(index);
    const outgoing = outgoingOf(index);
    if (incoming < 0 || outgoing < 0 || !(radiusAt(node) > 0)) return null;
    return cornerGeometry(
      segments[incoming]!.controls,
      segments[outgoing]!.controls,
    );
  });
  // Each segment's length is shared by the corners at its two ends in
  // proportion to what their radius asks for (Figma), so a rhombus rounds
  // into its incircle and an open end cedes the whole segment.
  const need = (index: number) =>
    geometry[index] ? radiusAt(nodes[index]!) / geometry[index]!.halfTan : 0;
  const effective = nodes.map((node) => radiusAt(node));
  segments.forEach((segment, index) => {
    const from = index;
    const to = (index + 1) % count;
    const [p0, , , p3] = segment.controls;
    const length = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const total = need(from) + need(to);
    if (total <= length || total === 0) return;
    const scale = length / total;
    effective[from] = Math.min(
      effective[from]!,
      radiusAt(nodes[from]!) * scale,
    );
    effective[to] = Math.min(effective[to]!, radiusAt(nodes[to]!) * scale);
  });
  const corners = nodes.map((_, index) => {
    const corner = geometry[index];
    if (!corner) return null;
    const tangent = effective[index]! / corner.halfTan;
    if (!(tangent > 0)) return null;
    const incoming = segments[incomingOf(index)]!;
    const outgoing = segments[outgoingOf(index)]!;
    incoming.tEnd = parameterAtDistance(
      incoming.controls,
      corner.vertex,
      tangent,
      true,
    );
    outgoing.tStart = parameterAtDistance(
      outgoing.controls,
      corner.vertex,
      tangent,
      false,
    );
    return { radius: effective[index]!, sweep: corner.sweep };
  });

  const piece = (index: number) => {
    const segment = segments[index]!;
    return subCubic(segment.controls, segment.tStart, segment.tEnd);
  };
  const at = (point: PenPoint) => formatPoint(point, decimals);
  const commands = [`M ${at(piece(0)[0])}`];
  for (let index = 0; index < segmentCount; index++) {
    const [, c1, c2, end] = piece(index);
    commands.push(
      segments[index]!.straight
        ? `L ${at(end)}`
        : `C ${at(c1)} ${at(c2)} ${at(end)}`,
    );
    const corner = corners[(index + 1) % count];
    if (corner && (closed || index + 1 < count)) {
      const r = roundCoord(corner.radius, decimals);
      const next = piece((index + 1) % segmentCount)[0];
      commands.push(`A ${r} ${r} 0 0 ${corner.sweep} ${at(next)}`);
    }
  }
  if (closed) commands.push("Z");
  return commands.join(" ");
}

function isStraightSegment(path: PenPath, segmentIndex: number) {
  const from = path.nodes[segmentIndex]!;
  const to = path.nodes[(segmentIndex + 1) % path.nodes.length]!;
  return (
    (!from.handleOut || samePoint(from.handleOut, from.point)) &&
    (!to.handleIn || samePoint(to.handleIn, to.point))
  );
}

type Cubic = [PenPoint, PenPoint, PenPoint, PenPoint];

function cornerGeometry(incoming: Cubic, outgoing: Cubic) {
  const vertex = incoming[3];
  const unit = (to: PenPoint) => {
    const length = Math.hypot(to.x - vertex.x, to.y - vertex.y);
    return length === 0
      ? null
      : { x: (to.x - vertex.x) / length, y: (to.y - vertex.y) / length };
  };
  // Direction along each segment away from the vertex, from its nearest
  // distinct control point.
  const back = [incoming[2], incoming[1], incoming[0]].map(unit).find(Boolean);
  const ahead = [outgoing[1], outgoing[2], outgoing[3]].map(unit).find(Boolean);
  if (!back || !ahead) return null;
  const cos = Math.max(-1, Math.min(1, back.x * ahead.x + back.y * ahead.y));
  const angle = Math.acos(cos);
  if (angle < 1e-3 || Math.PI - angle < 1e-3) return null;
  return {
    vertex,
    halfTan: Math.tan(angle / 2),
    sweep: -back.x * ahead.y + back.y * ahead.x > 0 ? 1 : 0,
  };
}

/** Curve parameter whose point lies `distance` from `vertex`, searching in
 *  from the end (`fromEnd`) or the start that touches the vertex. */
function parameterAtDistance(
  curve: Cubic,
  vertex: PenPoint,
  distance: number,
  fromEnd: boolean,
) {
  const at = (t: number) =>
    Math.hypot(
      cubicBezierValue(curve[0].x, curve[1].x, curve[2].x, curve[3].x, t) -
        vertex.x,
      cubicBezierValue(curve[0].y, curve[1].y, curve[2].y, curve[3].y, t) -
        vertex.y,
    );
  let near = fromEnd ? 1 : 0;
  let far = fromEnd ? 0 : 1;
  for (let step = 0; step < 40; step++) {
    const mid = (near + far) / 2;
    if (at(mid) < distance) near = mid;
    else far = mid;
  }
  return (near + far) / 2;
}

function lerpPoint(a: PenPoint, b: PenPoint, t: number): PenPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The part of a cubic between parameters `t0` and `t1` (de Casteljau). */
function subCubic(curve: Cubic, t0: number, t1: number): Cubic {
  const split = (c: Cubic, t: number): [Cubic, Cubic] => {
    const [p0, p1, p2, p3] = c;
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    const d = lerpPoint(p2, p3, t);
    const e = lerpPoint(a, b, t);
    const f = lerpPoint(b, d, t);
    const g = lerpPoint(e, f, t);
    return [
      [p0, a, e, g],
      [g, f, d, p3],
    ];
  };
  if (t0 <= 0 && t1 >= 1) return curve;
  const tail = t0 > 0 ? split(curve, t0)[1] : curve;
  if (t1 >= 1) return tail;
  return split(tail, (t1 - t0) / (1 - t0))[0];
}

/**
 * Nearest point on any segment of `path` within `radius`: the segment starts
 * at node `segmentIndex` (the closing segment of a closed path is the last
 * index) and `t` is the curve parameter of the hit.
 */
export function hitTestPenSegment(
  path: PenPath,
  point: PenPoint,
  radius: number,
): { segmentIndex: number; t: number } | null {
  const count = path.nodes.length;
  const segments = path.closed && count > 1 ? count : count - 1;
  const SAMPLES = 48;
  let best: { segmentIndex: number; t: number } | null = null;
  let bestDistance = radius;
  for (let index = 0; index < segments; index++) {
    const [p0, c1, c2, p3] = segmentControls(path, index);
    for (let step = 1; step < SAMPLES; step++) {
      const t = step / SAMPLES;
      const distance = Math.hypot(
        cubicBezierValue(p0.x, c1.x, c2.x, p3.x, t) - point.x,
        cubicBezierValue(p0.y, c1.y, c2.y, p3.y, t) - point.y,
      );
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { segmentIndex: index, t };
      }
    }
  }
  return best;
}

/**
 * Bends one segment so the point grabbed at curve parameter `t` follows the
 * pointer by `delta`; both anchors stay put (Figma's segment drag).
 */
export function bendPenSegment(
  path: PenPath,
  segmentIndex: number,
  t: number,
  delta: PenPoint,
): PenPath {
  const count = path.nodes.length;
  const fromIndex = segmentIndex;
  const toIndex = (segmentIndex + 1) % count;
  if (!isValidNodeIndex(path, fromIndex) || count < 2) {
    return clonePenPath(path);
  }
  const [, c1, c2] = segmentControls(path, segmentIndex);
  const clampedT = Math.min(0.95, Math.max(0.05, t));
  const scale = 1 / (3 * clampedT * (1 - clampedT));
  const shift = { x: delta.x * scale, y: delta.y * scale };
  const nodes = path.nodes.map(clonePenNode);
  nodes[fromIndex] = {
    ...nodes[fromIndex]!,
    handleOut: { x: c1.x + shift.x, y: c1.y + shift.y },
  };
  nodes[toIndex] = {
    ...nodes[toIndex]!,
    handleIn: { x: c2.x + shift.x, y: c2.y + shift.y },
  };
  return { nodes, closed: path.closed };
}

/** The vector's radius replaces every vertex radius, as in Figma. */
export function withoutVertexRadii(path: PenPath): PenPath {
  return {
    ...path,
    nodes: path.nodes.map(({ cornerRadius: _radius, ...node }) => node),
  };
}

/** Maximum circular radius supported for a straight-sided corner anchor. */
export function maxPenCornerRadius(
  path: PenPath,
  nodeIndex: number,
): number | null {
  if (!path.closed) return null;
  if (!isValidNodeIndex(path, nodeIndex)) return null;
  const count = path.nodes.length;
  const node = path.nodes[nodeIndex]!;
  if (node.handleIn || node.handleOut) return null;
  const previousIndex =
    nodeIndex > 0 ? nodeIndex - 1 : path.closed ? count - 1 : -1;
  const nextIndex =
    nodeIndex < count - 1 ? nodeIndex + 1 : path.closed ? 0 : -1;
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex)
    return null;
  const previous = path.nodes[previousIndex]!;
  const next = path.nodes[nextIndex]!;
  if (previous.handleOut || next.handleIn) return null;
  const incoming = {
    x: previous.point.x - node.point.x,
    y: previous.point.y - node.point.y,
  };
  const outgoing = {
    x: next.point.x - node.point.x,
    y: next.point.y - node.point.y,
  };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
  if (incomingLength === 0 || outgoingLength === 0) return null;
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (incoming.x * outgoing.x + incoming.y * outgoing.y) /
        (incomingLength * outgoingLength),
    ),
  );
  if (cosine <= -0.9999999 || cosine >= 0.9999999) return null;
  const halfAngleTangent = Math.tan(Math.acos(cosine) / 2);
  if (!Number.isFinite(halfAngleTangent) || halfAngleTangent <= 1e-6)
    return null;
  return Math.min(incomingLength, outgoingLength) * 0.5 * halfAngleTangent;
}

/** Set a circular radius on a straight-sided Pen anchor; unsupported geometry fails closed. */
export function setPenNodeCornerRadius(
  path: PenPath,
  nodeIndex: number,
  radius: number,
): PenPath | null {
  const maximum = maxPenCornerRadius(path, nodeIndex);
  if (maximum === null || !Number.isFinite(radius) || radius < 0) return null;
  const nodes = path.nodes.map(clonePenNode);
  nodes[nodeIndex]!.cornerRadius = Math.min(radius, maximum);
  return { nodes, closed: path.closed };
}

/** A straight segment's implicit control points sit a third of the way along. */
function segmentControls(
  path: PenPath,
  segmentIndex: number,
): [PenPoint, PenPoint, PenPoint, PenPoint] {
  const from = path.nodes[segmentIndex]!;
  const to = path.nodes[(segmentIndex + 1) % path.nodes.length]!;
  const p0 = from.point;
  const p3 = to.point;
  if (isStraightSegment(path, segmentIndex)) {
    return [
      p0,
      { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
      { x: p0.x + ((p3.x - p0.x) * 2) / 3, y: p0.y + ((p3.y - p0.y) * 2) / 3 },
      p3,
    ];
  }
  return [p0, from.handleOut ?? p0, to.handleIn ?? p3, p3];
}

/** Reads back the trailing "Z" `serializePenPath` emits for a closed path. */
export function isClosedPathData(data: string | null | undefined): boolean {
  return Boolean(data && /Z\s*$/i.test(data.trim()));
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

function serializeSegment(from: PenNode, to: PenNode, decimals = 1) {
  const c1 = from.handleOut ?? from.point;
  const c2 = to.handleIn ?? to.point;
  if (samePoint(c1, from.point) && samePoint(c2, to.point)) {
    return `L ${formatPoint(to.point, decimals)}`;
  }
  return `C ${formatPoint(c1, decimals)} ${formatPoint(c2, decimals)} ${formatPoint(to.point, decimals)}`;
}

function transformPenPath(
  path: PenPath,
  transform: (point: PenPoint) => PenPoint,
): PenPath {
  return {
    nodes: path.nodes.map((node) => {
      return copyVertexMeta(node, {
        point: transform(node.point),
        handleIn: node.handleIn ? transform(node.handleIn) : undefined,
        handleOut: node.handleOut ? transform(node.handleOut) : undefined,
      });
    }),
    closed: path.closed,
  };
}

function clonePenNode(node: PenNode): PenNode {
  return copyVertexMeta(node, {
    point: { ...node.point },
    handleIn: node.handleIn ? { ...node.handleIn } : undefined,
    handleOut: node.handleOut ? { ...node.handleOut } : undefined,
  });
}

function mirrorPoint(anchor: PenPoint, point: PenPoint): PenPoint {
  return {
    x: anchor.x - (point.x - anchor.x),
    y: anchor.y - (point.y - anchor.y),
  };
}

function formatPoint(point: PenPoint, decimals = 1) {
  return `${roundCoord(point.x, decimals)} ${roundCoord(point.y, decimals)}`;
}

function roundCoord(value: number, decimals = 1) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function samePoint(a: PenPoint, b: PenPoint) {
  return a.x === b.x && a.y === b.y;
}
