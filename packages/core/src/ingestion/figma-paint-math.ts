

export interface Vec2 {
  x: number;
  y: number;
}

export interface GradientHandles {
  start: Vec2;
  end: Vec2;
  width: Vec2;
}

export interface Mat2x3Object {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

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

function applyMat2x3(m: Mat2x3Object, v: Vec2): Vec2 {
  return {
    x: m.m00 * v.x + m.m01 * v.y + m.m02,
    y: m.m10 * v.x + m.m11 * v.y + m.m12,
  };
}


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

export function handlePositionsFromArrayTransform(
  t: Mat2x3Array,
): GradientHandles | null {
  return handlePositionsFromObjectTransform(mat2x3FromArray(t));
}


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


export function gradientAngleDegrees(
  paint: { gradientHandlePositions?: Array<Vec2> },
  box: { width: number; height: number },
): number | null {
  const handles = resolveGradientHandles(paint.gradientHandlePositions);
  if (!handles) return null;
  return gradientAngleDegreesFromHandles(handles, box);
}

export function gradientAngleDegreesFromHandles(
  handles: GradientHandles,
  box: { width: number; height: number },
): number {
  const dx = (handles.end.x - handles.start.x) * box.height;
  const dy = (handles.end.y - handles.start.y) * box.width;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = (angleRad * 180) / Math.PI + 90;
  return ((angleDeg % 360) + 360) % 360;
}

export function gradientRayAngleDegreesFromHandles(
  handles: GradientHandles,
  box: { width: number; height: number },
): number {
  const dx = (handles.end.x - handles.start.x) * box.width;
  const dy = (handles.end.y - handles.start.y) * box.height;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return ((angleDeg % 360) + 360) % 360;
}


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


export function vectorLength(
  from: Vec2,
  to: Vec2,
  box: { width: number; height: number },
): number {
  const dx = (to.x - from.x) * box.width;
  const dy = (to.y - from.y) * box.height;
  return Math.sqrt(dx * dx + dy * dy);
}


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

const FIGMA_ONLY_BLEND_MODE_FALLBACK: Record<string, string> = {
  LINEAR_BURN: "multiply",
  LINEAR_DODGE: "plus-lighter",
  LIGHTER: "plus-lighter",
  DARKER: "darken",
};

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
