import {
  isNativePositionValue,
  packNativePosition,
  type NativePositionValue,
  type NativePositionUnit,
} from "@shared/native-effect-position";

export const NATIVE_POSITION_ANCHORS = [
  { value: "left top", key: "nativePositionTopLeft", x: 0, y: 0 },
  { value: "top", key: "nativePositionTop", x: 0.5, y: 0 },
  { value: "right top", key: "nativePositionTopRight", x: 1, y: 0 },
  { value: "left", key: "nativePositionLeft", x: 0, y: 0.5 },
  { value: "center", key: "nativePositionCenter", x: 0.5, y: 0.5 },
  { value: "right", key: "nativePositionRight", x: 1, y: 0.5 },
  { value: "left bottom", key: "nativePositionBottomLeft", x: 0, y: 1 },
  { value: "bottom", key: "nativePositionBottom", x: 0.5, y: 1 },
  { value: "right bottom", key: "nativePositionBottomRight", x: 1, y: 1 },
] as const;

export function nativePositionAxisDisplay(
  value: NativePositionValue,
  axis: "x" | "y",
) {
  const packed = packNativePosition(value);
  const index = axis === "x" ? 0 : 1;
  const unitCode = packed[index + 2];
  return {
    value: packed[index],
    unit:
      unitCode === 1
        ? ("px" as const)
        : unitCode === 2
          ? ("percent" as const)
          : ("uv" as const),
  };
}

export function nativePositionAnchor(value: NativePositionValue): string {
  const x = nativePositionAxisDisplay(value, "x");
  const y = nativePositionAxisDisplay(value, "y");
  if (x.unit === "px" || y.unit === "px") return "custom";
  const normalizedX = x.unit === "percent" ? x.value / 100 : x.value;
  const normalizedY = y.unit === "percent" ? y.value / 100 : y.value;
  const anchor = NATIVE_POSITION_ANCHORS.find(
    (item) => item.x === normalizedX && item.y === normalizedY,
  );
  return anchor ? anchor.value : "custom";
}

export function updateNativePositionAxis(
  value: NativePositionValue,
  axis: "x" | "y",
  next: { value: number; unit: NativePositionUnit },
): NativePositionValue {
  const packed = packNativePosition(value);
  const base =
    typeof value === "string" ? { x: packed[0], y: packed[1] } : value;
  const result = { ...base, [axis]: next };
  if (!isNativePositionValue(result))
    throw new TypeError("Position control value is invalid.");
  return result;
}

export function changeNativePositionUnit(
  value: NativePositionValue,
  axis: "x" | "y",
  unit: NativePositionUnit,
): NativePositionValue {
  const current = nativePositionAxisDisplay(value, axis);
  let number = current.value;
  if (current.unit === "uv" && unit === "percent") number *= 100;
  if (current.unit === "percent" && unit === "uv") number /= 100;
  return updateNativePositionAxis(value, axis, { value: number, unit });
}
