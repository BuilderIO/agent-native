import type { NativeClipRadii } from "../../../../shared/native-clip-geometry";

export interface NativeAffine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface NativeAffineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type NativeAffineFailure = {
  ok: false;
  reason:
    | "invalid-box"
    | "invalid-scale"
    | "non-finite"
    | "singular"
    | "unrepresentable";
};

export type NativeAffineMatrixResult =
  | { ok: true; matrix: NativeAffine2D }
  | NativeAffineFailure;

export interface NativeSourceAffinePlan {
  ok: true;
  localBox: NativeAffineBox;
  localToPhysical: NativeAffine2D;
  physicalToLocal: NativeAffine2D;
  physicalBounds: NativeAffineBox;
}

export type NativeSourceAffinePlanResult =
  | NativeSourceAffinePlan
  | NativeAffineFailure;

const components = (matrix: NativeAffine2D): number[] => [
  matrix.a,
  matrix.b,
  matrix.c,
  matrix.d,
  matrix.e,
  matrix.f,
];

function finiteMatrix(matrix: NativeAffine2D): boolean {
  return components(matrix).every(Number.isFinite);
}

function representableMatrix(matrix: NativeAffine2D): boolean {
  return components(matrix).every((value) =>
    Number.isFinite(Math.fround(value)),
  );
}

function f32Matrix(matrix: NativeAffine2D): NativeAffine2D {
  return {
    a: Math.fround(matrix.a),
    b: Math.fround(matrix.b),
    c: Math.fround(matrix.c),
    d: Math.fround(matrix.d),
    e: Math.fround(matrix.e),
    f: Math.fround(matrix.f),
  };
}

export function composeNativeSourceAffine(
  outer: NativeAffine2D,
  inner: NativeAffine2D,
): NativeAffineMatrixResult {
  if (!finiteMatrix(outer) || !finiteMatrix(inner))
    return { ok: false, reason: "non-finite" };
  const matrix = {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
  if (!finiteMatrix(matrix)) return { ok: false, reason: "non-finite" };
  if (!representableMatrix(matrix))
    return { ok: false, reason: "unrepresentable" };
  return { ok: true, matrix };
}

export function invertNativeSourceAffine(
  matrix: NativeAffine2D,
): NativeAffineMatrixResult {
  if (!finiteMatrix(matrix)) return { ok: false, reason: "non-finite" };
  if (!representableMatrix(matrix))
    return { ok: false, reason: "unrepresentable" };
  const rounded = f32Matrix(matrix);
  const determinant = rounded.a * rounded.d - rounded.b * rounded.c;
  if (!Number.isFinite(determinant))
    return { ok: false, reason: "unrepresentable" };
  if (determinant === 0) return { ok: false, reason: "singular" };
  const inverse = {
    a: rounded.d / determinant,
    b: -rounded.b / determinant,
    c: -rounded.c / determinant,
    d: rounded.a / determinant,
    e: (rounded.c * rounded.f - rounded.d * rounded.e) / determinant,
    f: (rounded.b * rounded.e - rounded.a * rounded.f) / determinant,
  };
  if (!finiteMatrix(inverse) || !representableMatrix(inverse))
    return { ok: false, reason: "unrepresentable" };
  return { ok: true, matrix: f32Matrix(inverse) };
}

export function mapNativeSourceAffine(
  matrix: NativeAffine2D,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function planNativeSourceAffine(input: {
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  physicalScale: { x: number; y: number };
}): NativeSourceAffinePlanResult {
  const { localBox, localToTarget, physicalScale } = input;
  if (
    ![localBox.x, localBox.y, localBox.width, localBox.height].every(
      Number.isFinite,
    ) ||
    localBox.width <= 0 ||
    localBox.height <= 0 ||
    !Number.isFinite(localBox.x + localBox.width) ||
    !Number.isFinite(localBox.y + localBox.height)
  )
    return { ok: false, reason: "invalid-box" };
  if (
    !Number.isFinite(physicalScale.x) ||
    !Number.isFinite(physicalScale.y) ||
    physicalScale.x <= 0 ||
    physicalScale.y <= 0
  )
    return { ok: false, reason: "invalid-scale" };
  const scaled = composeNativeSourceAffine(
    {
      a: physicalScale.x,
      b: 0,
      c: 0,
      d: physicalScale.y,
      e: 0,
      f: 0,
    },
    localToTarget,
  );
  if (!scaled.ok) return scaled;
  const localToPhysical = f32Matrix(scaled.matrix);
  const inverted = invertNativeSourceAffine(localToPhysical);
  if (!inverted.ok) return inverted;
  const corners = [
    { x: localBox.x, y: localBox.y },
    { x: localBox.x + localBox.width, y: localBox.y },
    { x: localBox.x, y: localBox.y + localBox.height },
    { x: localBox.x + localBox.width, y: localBox.y + localBox.height },
  ].map((point) => mapNativeSourceAffine(localToPhysical, point));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const physicalBounds = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  if (
    ![
      left,
      top,
      right,
      bottom,
      physicalBounds.width,
      physicalBounds.height,
    ].every(Number.isFinite) ||
    ![
      left,
      top,
      right,
      bottom,
      physicalBounds.width,
      physicalBounds.height,
      localBox.x,
      localBox.y,
      localBox.width,
      localBox.height,
    ].every((value) => Number.isFinite(Math.fround(value)))
  )
    return { ok: false, reason: "unrepresentable" };
  return {
    ok: true,
    localBox,
    localToPhysical,
    physicalToLocal: inverted.matrix,
    physicalBounds,
  };
}

export function sampleNativeSourceAffine(
  plan: NativeSourceAffinePlan,
  physicalPoint: { x: number; y: number },
):
  | {
      ok: true;
      local: { x: number; y: number };
      uv: { x: number; y: number };
      inside: boolean;
    }
  | NativeAffineFailure {
  if (!Number.isFinite(physicalPoint.x) || !Number.isFinite(physicalPoint.y))
    return { ok: false, reason: "non-finite" };
  const local = mapNativeSourceAffine(plan.physicalToLocal, physicalPoint);
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y))
    return { ok: false, reason: "unrepresentable" };
  const { localBox } = plan;
  const uv = {
    x: (local.x - localBox.x) / localBox.width,
    y: (local.y - localBox.y) / localBox.height,
  };
  return {
    ok: true,
    local,
    uv,
    inside: uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1,
  };
}

export function pointInsideNativeSourceAffineClip(
  plan: NativeSourceAffinePlan,
  physicalPoint: { x: number; y: number },
  radii: NativeClipRadii,
):
  | { ok: true; inside: boolean }
  | NativeAffineFailure
  | { ok: false; reason: "invalid-radii" } {
  const sampled = sampleNativeSourceAffine(plan, physicalPoint);
  if (!sampled.ok) return sampled;
  const { localBox } = plan;
  const corners = [
    radii.topLeft,
    radii.topRight,
    radii.bottomRight,
    radii.bottomLeft,
  ];
  if (
    corners.some(
      ({ x, y }) =>
        !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0,
    ) ||
    radii.topLeft.x + radii.topRight.x > localBox.width ||
    radii.bottomLeft.x + radii.bottomRight.x > localBox.width ||
    radii.topLeft.y + radii.bottomLeft.y > localBox.height ||
    radii.topRight.y + radii.bottomRight.y > localBox.height
  )
    return { ok: false, reason: "invalid-radii" };
  if (!sampled.inside) return { ok: true, inside: false };
  const x = sampled.local.x - localBox.x;
  const y = sampled.local.y - localBox.y;
  const ellipse = (
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
  ): boolean =>
    radiusX === 0 ||
    radiusY === 0 ||
    ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1;
  if (x < radii.topLeft.x && y < radii.topLeft.y)
    return {
      ok: true,
      inside: ellipse(
        radii.topLeft.x,
        radii.topLeft.y,
        radii.topLeft.x,
        radii.topLeft.y,
      ),
    };
  const topRightStart = localBox.width - radii.topRight.x;
  const beyondRight = x > topRightStart;
  const aboveRightCorner = y < radii.topRight.y;
  if (beyondRight && aboveRightCorner)
    return {
      ok: true,
      inside: ellipse(
        localBox.width - radii.topRight.x,
        radii.topRight.y,
        radii.topRight.x,
        radii.topRight.y,
      ),
    };
  if (
    x > localBox.width - radii.bottomRight.x &&
    y > localBox.height - radii.bottomRight.y
  )
    return {
      ok: true,
      inside: ellipse(
        localBox.width - radii.bottomRight.x,
        localBox.height - radii.bottomRight.y,
        radii.bottomRight.x,
        radii.bottomRight.y,
      ),
    };
  if (x < radii.bottomLeft.x && y > localBox.height - radii.bottomLeft.y)
    return {
      ok: true,
      inside: ellipse(
        radii.bottomLeft.x,
        localBox.height - radii.bottomLeft.y,
        radii.bottomLeft.x,
        radii.bottomLeft.y,
      ),
    };
  return { ok: true, inside: true };
}
