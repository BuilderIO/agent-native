/**
 * Pure, synchronous math helpers for Figma gradient geometry and blend-mode
 * normalisation. No DOM, no CSS, no network.
 *
 * Supports two gradient-transform sources:
 *   - REST API `gradientHandlePositions` (3-element Vec2 array, already in
 *     normalized 0..1 node-space).
 *   - 2×3 affine transform in **either** the Kiwi/fig-file object form
 *     `{m00..m12}` or the REST/Plugin API array form `[[a,b,tx],[c,d,ty]]`.
 *     Both encode the **node-to-gradient** mapping (same convention as Figma's
 *     own `gradientTransform` field); invert to obtain handle positions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

export interface GradientHandles {
  start: Vec2;
  end: Vec2;
  width: Vec2;
}

/**
 * 2×3 affine transform in the row-major object form used by Kiwi/fig-file
 * decoded paint nodes:
 *   [m00, m01, m02]
 *   [m10, m11, m12]
 */
export interface Mat2x3Object {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

/**
 * 2×3 affine transform in the nested-array form used by the Figma REST API
 * and Plugin API `gradientTransform` field:
 *   [[a, b, tx], [c, d, ty]]
 */
export type Mat2x3Array = [[number, number, number], [number, number, number]];

export type BlendVerdict = "exact" | "approximated";

export interface BlendModeResult {
  cssMode: string;
  verdict: BlendVerdict;
}

export type GradientKind = "LINEAR" | "RADIAL" | "ANGULAR" | "DIAMOND";

export interface GradientGeometry {
  kind: GradientKind;
  handles: GradientHandles;
  start: Vec2;
  end: Vec2;
  center: Vec2;
  rx: number;
  ry: number;
  rotationDeg: number;
  fromDeg: number;
}

// ---------------------------------------------------------------------------
// Matrix helpers
// ---------------------------------------------------------------------------

/** Convert the REST/Plugin nested-array form to the object form. */
export function mat2x3FromArray(m: Mat2x3Array): Mat2x3Object {
  return {
    m00: m[0][0],
    m01: m[0][1],
    m02: m[0][2],
    m10: m[1][0],
    m11: m[1][1],
    m12: m[1][2],
  };
}

/**
 * Invert a 2×3 affine transform.  Returns null when the matrix is singular
 * (determinant near zero, i.e. the gradient has collapsed to a line or point).
 *
 * The 2×2 rotation/scale sub-matrix is [[m00,m01],[m10,m11]]; the
 * standard 2×2 inverse is applied and the translation is back-solved:
 *   inv_tx = (-m11*m02 + m01*m12) / det
 *   inv_ty = ( m10*m02 - m00*m12) / det
 */
export function invert2x3(m: Mat2x3Object): Mat2x3Object | null {
  const det = m.m00 * m.m11 - m.m01 * m.m10;
  if (Math.abs(det) < 1e-8) return null;
  const inv00 = m.m11 / det;
  const inv01 = -m.m01 / det;
  const inv10 = -m.m10 / det;
  const inv11 = m.m00 / det;
  return {
    m00: inv00,
    m01: inv01,
    m02: (-m.m11 * m.m02 + m.m01 * m.m12) / det,
    m10: inv10,
    m11: inv11,
    m12: (m.m10 * m.m02 - m.m00 * m.m12) / det,
  };
}

/**
 * Apply a 2×3 transform to a 2-D point.
 * The point is treated as a homogeneous [x, y, 1]^T column vector.
 */
function applyMat2x3(m: Mat2x3Object, v: Vec2): Vec2 {
  return {
    x: m.m00 * v.x + m.m01 * v.y + m.m02,
    y: m.m10 * v.x + m.m11 * v.y + m.m12,
  };
}

// ---------------------------------------------------------------------------
// Handle positions from transforms
// ---------------------------------------------------------------------------

/**
 * Derive REST-style `GradientHandles` from a 2×3 **node-to-gradient**
 * transform in Kiwi/fig-file object form.
 *
 * Figma's gradient transform encodes where the gradient's natural coordinate
 * system sits inside the node's normalized [0,1]² box.  The three canonical
 * gradient-space points (start, end, width) map back to node-space by
 * inverting the transform:
 *   handles = inv(M) * {(0,0), (1,0), (0,1)}
 */
export function handlePositionsFromObjectTransform(
  t: Mat2x3Object,
): GradientHandles | null {
  const inv = invert2x3(t);
  if (!inv) return null;
  return {
    start: applyMat2x3(inv, { x: 0, y: 0 }),
    end: applyMat2x3(inv, { x: 1, y: 0 }),
    width: applyMat2x3(inv, { x: 0, y: 1 }),
  };
}

export function gradientGeometryFromTransform(
  kind: GradientKind,
  transform: Mat2x3Object,
  box: { width: number; height: number },
): GradientGeometry | null {
  const inverse = invert2x3(transform);
  if (!inverse) return null;
  const toPixels = (point: Vec2): Vec2 => ({
    x: point.x * box.width,
    y: point.y * box.height,
  });
  const startNormalized = applyMat2x3(inverse, { x: 0, y: 0.5 });
  const endNormalized = applyMat2x3(inverse, { x: 1, y: 0.5 });
  const widthNormalized = applyMat2x3(inverse, { x: 1, y: 0 });
  const center = toPixels(applyMat2x3(inverse, { x: 0.5, y: 0.5 }));
  const vertex = toPixels(applyMat2x3(inverse, { x: 1, y: 0.5 }));
  const covertex = toPixels(applyMat2x3(inverse, { x: 0.5, y: 1 }));
  const vertexDx = vertex.x - center.x;
  const vertexDy = vertex.y - center.y;
  return {
    kind,
    handles: {
      start: startNormalized,
      end: endNormalized,
      width: widthNormalized,
    },
    start: toPixels(startNormalized),
    end: toPixels(endNormalized),
    center,
    rx: Math.hypot(vertexDx, vertexDy),
    ry: Math.hypot(covertex.x - center.x, covertex.y - center.y),
    rotationDeg: (Math.atan2(vertexDy, vertexDx) * 180) / Math.PI,
    fromDeg: (Math.atan2(-transform.m10, transform.m00) * 180) / Math.PI,
  };
}

/**
 * Derive REST-style `GradientHandles` from a 2×3 **node-to-gradient**
 * transform in REST/Plugin API nested-array form.
 */
export function handlePositionsFromArrayTransform(
  t: Mat2x3Array,
): GradientHandles | null {
  return handlePositionsFromObjectTransform(mat2x3FromArray(t));
}

// ---------------------------------------------------------------------------
// Gradient geometry from REST handle positions
// ---------------------------------------------------------------------------

/**
 * Resolve `GradientHandles` from a raw `gradientHandlePositions` array as
 * returned by the Figma REST API.  Returns null when the array is too short.
 */
export function resolveGradientHandles(
  gradientHandlePositions: Array<Vec2> | undefined,
): GradientHandles | null {
  if (!gradientHandlePositions || gradientHandlePositions.length < 3)
    return null;
  return {
    start: gradientHandlePositions[0]!,
    end: gradientHandlePositions[1]!,
    width: gradientHandlePositions[2]!,
  };
}

// ---------------------------------------------------------------------------
// Gradient angle
// ---------------------------------------------------------------------------

/**
 * Derive a CSS `linear-gradient()` angle (degrees) from Figma's normalized
 * `gradientHandlePositions`.  Handle positions are normalized independently in
 * x and y (0..1 relative to the node's bounding box), so the angle must be
 * computed in actual pixel space using the node's real width/height —
 * otherwise a non-square box silently distorts the angle.
 *
 * Identity: left-to-right handles (start=(0,0.5), end=(1,0.5)) → 90 deg.
 * Top-to-bottom handles (start=(0.5,0), end=(0.5,1)) → 180 deg.
 *
 * This is the same function previously inlined in figma-node-to-html.ts and
 * is preserved here verbatim for public API compatibility.
 */
export function gradientAngleDegrees(
  paint: { gradientHandlePositions?: Array<Vec2> },
  box: { width: number; height: number },
): number | null {
  const handles = resolveGradientHandles(paint.gradientHandlePositions);
  if (!handles) return null;
  return gradientAngleDegreesFromHandles(handles, box);
}

/**
 * Same calculation as `gradientAngleDegrees` but accepts already-resolved
 * `GradientHandles` — useful when handles come from a transform inversion.
 */
export function gradientAngleDegreesFromHandles(
  handles: GradientHandles,
  box: { width: number; height: number },
): number {
  const dx = (handles.end.x - handles.start.x) * box.width;
  const dy = (handles.end.y - handles.start.y) * box.height;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = (angleRad * 180) / Math.PI + 90;
  return ((angleDeg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Linear stop position remapping
// ---------------------------------------------------------------------------

/**
 * CSS `linear-gradient(angle, ...)` always stretches its 0%/100% stops across
 * the box's full diagonal at that angle (the CSS "gradient line" always spans
 * corner-to-corner).  Figma's stop positions are fractions of the literal
 * handle-to-handle distance, which only coincides with the CSS span when the
 * handles are dragged exactly corner-to-corner.
 *
 * This function returns a remap closure that projects each Figma stop's real
 * pixel position onto the CSS gradient line and re-expresses it as a
 * percentage of the CSS line's length, so a partial/offset gradient renders at
 * the same pixel positions Figma draws it at.
 */
export function remapLinearStopPosition(
  handles: GradientHandles,
  box: { width: number; height: number },
  angleDeg: number,
): (position: number) => number {
  const angleRad = (angleDeg * Math.PI) / 180;
  const ux = Math.sin(angleRad);
  const uy = -Math.cos(angleRad);
  const lineLength = box.width * Math.abs(ux) + box.height * Math.abs(uy);
  if (lineLength < 1e-6) return (position) => position;
  const startPx = {
    x: handles.start.x * box.width,
    y: handles.start.y * box.height,
  };
  const endPx = { x: handles.end.x * box.width, y: handles.end.y * box.height };
  const cx = box.width / 2;
  const cy = box.height / 2;
  return (position: number): number => {
    const px = startPx.x + position * (endPx.x - startPx.x);
    const py = startPx.y + position * (endPx.y - startPx.y);
    const projected = (px - cx) * ux + (py - cy) * uy;
    return (projected + lineLength / 2) / lineLength;
  };
}

// ---------------------------------------------------------------------------
// Vector length (pixel-space)
// ---------------------------------------------------------------------------

/**
 * Euclidean distance between two normalized-coordinate points after scaling
 * into actual pixel space.
 */
export function vectorLength(
  from: Vec2,
  to: Vec2,
  box: { width: number; height: number },
): number {
  const dx = (to.x - from.x) * box.width;
  const dy = (to.y - from.y) * box.height;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// CSS blend mode mapping
// ---------------------------------------------------------------------------

const CSS_BLEND_MODES = new Set([
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

/**
 * Figma-only blend modes that have no exact CSS equivalent.  The value is the
 * closest CSS mode (approximation) and callers should record the verdict.
 */
const FIGMA_ONLY_BLEND_MODE_FALLBACK: Record<string, string> = {
  LINEAR_BURN: "plus-darker",
  LINEAR_DODGE: "plus-lighter",
  LIGHTER: "plus-lighter",
  DARKER: "darken",
};

/**
 * Map a Figma blend mode string to a CSS `mix-blend-mode` value with an
 * explicit fidelity verdict:
 *   - `"exact"` — CSS supports the mode natively.
 *   - `"approximated"` — mapped to the closest CSS equivalent.
 *
 * Returns `null` for `PASS_THROUGH`, `NORMAL`, and unrecognised modes (caller
 * should omit the CSS property entirely in those cases).
 */
export function cssBlendMode(figmaBlendMode: string): BlendModeResult | null {
  if (
    !figmaBlendMode ||
    figmaBlendMode === "PASS_THROUGH" ||
    figmaBlendMode === "NORMAL"
  )
    return null;
  const cssMode = figmaBlendMode.toLowerCase().replace(/_/g, "-");
  if (CSS_BLEND_MODES.has(cssMode)) return { cssMode, verdict: "exact" };
  const fallback = FIGMA_ONLY_BLEND_MODE_FALLBACK[figmaBlendMode];
  if (fallback) return { cssMode: fallback, verdict: "approximated" };
  return null;
}
