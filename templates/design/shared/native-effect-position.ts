export type NativePositionUnit = "uv" | "percent" | "px";
export type NativePositionBasis = "source" | "viewport";
export type NativePositionDimension = {
  value: number;
  unit: NativePositionUnit;
};
export type NativePositionAxisX =
  | number
  | NativePositionDimension
  | "left"
  | "center"
  | "right";
export type NativePositionAxisY =
  | number
  | NativePositionDimension
  | "top"
  | "center"
  | "bottom";
export type NativePositionValue =
  | string
  | { x: NativePositionAxisX; y: NativePositionAxisY };

export interface NativePositionGeometry {
  source: { width: number; height: number };
  viewport: { width: number; height: number };
  pixelRatio: number;
}

export const MAX_NATIVE_POSITION_MAGNITUDE = 1_000_000;
const UV = 0;
const PX = 1;
const PERCENT = 2;
type PackedPosition = [number, number, number, number];

function bounded(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_NATIVE_POSITION_MAGNITUDE
  );
}

function axis(value: unknown, direction: "x" | "y"): [number, number] | null {
  if (bounded(value)) return [value, UV];
  if (typeof value === "string") {
    const keyword = value.trim().toLowerCase();
    if (keyword === "center") return [0.5, UV];
    if (direction === "x") {
      if (keyword === "left") return [0, UV];
      if (keyword === "right") return [1, UV];
    } else {
      if (keyword === "top") return [0, UV];
      if (keyword === "bottom") return [1, UV];
    }
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("value" in value) ||
    !("unit" in value) ||
    !bounded(value.value)
  )
    return null;
  if (value.unit === "uv") return [value.value, UV];
  if (value.unit === "px") return [value.value, PX];
  if (value.unit === "percent") return [value.value, PERCENT];
  return null;
}

function keywordPosition(value: string): PackedPosition | null {
  const parts = value.trim().toLowerCase().split(/\s+/);
  if (
    parts.length < 1 ||
    parts.length > 2 ||
    parts.some(
      (part) =>
        part !== "left" &&
        part !== "center" &&
        part !== "right" &&
        part !== "top" &&
        part !== "bottom",
    ) ||
    parts.filter((part) => part === "left" || part === "right").length > 1 ||
    parts.filter((part) => part === "top" || part === "bottom").length > 1
  )
    return null;
  const x = parts.includes("left") ? 0 : parts.includes("right") ? 1 : 0.5;
  const y = parts.includes("top") ? 0 : parts.includes("bottom") ? 1 : 0.5;
  return [x, y, UV, UV];
}

function parseNativePosition(value: unknown): PackedPosition | null {
  if (typeof value === "string") return keywordPosition(value);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("x" in value) ||
    !("y" in value)
  )
    return null;
  const x = axis(value.x, "x");
  const y = axis(value.y, "y");
  return x && y ? [x[0], y[0], x[1], y[1]] : null;
}

export function isNativePositionValue(
  value: unknown,
): value is NativePositionValue {
  return parseNativePosition(value) !== null;
}

export function packNativePosition(value: NativePositionValue): PackedPosition {
  const packed = parseNativePosition(value);
  if (!packed) throw new TypeError("native position is invalid");
  return packed;
}

export function resolveNativePosition(
  value: NativePositionValue,
  basis: NativePositionBasis,
  geometry: NativePositionGeometry,
): [number, number] {
  const packed = packNativePosition(value);
  const dimensions = geometry[basis];
  if (
    ![dimensions.width, dimensions.height, geometry.pixelRatio].every(
      (dimension) => Number.isFinite(dimension) && dimension > 0,
    )
  )
    throw new TypeError("native position geometry is invalid");
  const resolveAxis = (raw: number, unit: number, dimension: number) => {
    if (unit === PX) return (raw * geometry.pixelRatio) / dimension;
    if (unit === PERCENT) return raw / 100;
    return raw;
  };
  return [
    resolveAxis(packed[0], packed[2], dimensions.width),
    resolveAxis(packed[1], packed[3], dimensions.height),
  ];
}

export const NATIVE_POSITION_WGSL = `
fn nativePositionAxis(value: f32, unitCode: f32, physicalDimension: f32,
  pixelRatio: f32) -> f32 {
  if (unitCode > 1.5) { return value / 100.0; }
  if (unitCode > 0.5) { return value * pixelRatio / max(physicalDimension, 1.0); }
  return value;
}
fn nativePositionUv(packed: vec4f, physicalSize: vec2f,
  pixelRatio: f32) -> vec2f {
  return vec2f(nativePositionAxis(packed.x, packed.z, physicalSize.x, pixelRatio),
    nativePositionAxis(packed.y, packed.w, physicalSize.y, pixelRatio));
}
`;
