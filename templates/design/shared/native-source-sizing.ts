export interface NativeSourceSizing {
  inputSpace: "intrinsic-image" | "rendered-surface";
  aspectRatio: number;
  fit: "none" | "contain" | "cover";
  worldSize: [number, number];
  origin: [number, number];
  offset: [number, number];
  scale: number;
  rotationDegrees: number;
  sampling: {
    min: "nearest" | "linear";
    mag: "nearest" | "linear";
    mipmap: "none" | "nearest" | "linear";
  };
}

export function defaultNativeIntrinsicSourceSizing(
  intrinsicWidth: number,
  intrinsicHeight: number,
  defaultSampling?: NativeSourceSizing["sampling"],
):
  | { ok: true; value: NativeSourceSizing }
  | {
      ok: false;
      code:
        | "source-sizing-intrinsic-dimensions-invalid"
        | "source-sizing-default-sampling-invalid";
    } {
  const aspectRatio = intrinsicWidth / intrinsicHeight;
  if (
    !Number.isSafeInteger(intrinsicWidth) ||
    !Number.isSafeInteger(intrinsicHeight) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0 ||
    !bounded(aspectRatio, 1 / 64, 64)
  )
    return { ok: false, code: "source-sizing-intrinsic-dimensions-invalid" };
  if (
    defaultSampling !== undefined &&
    (!record(defaultSampling) ||
      !exactKeys(defaultSampling, ["min", "mag", "mipmap"]) ||
      defaultSampling.min !== "linear" ||
      defaultSampling.mag !== "linear" ||
      defaultSampling.mipmap !== "linear")
  )
    return { ok: false, code: "source-sizing-default-sampling-invalid" };
  return {
    ok: true,
    value: {
      inputSpace: "intrinsic-image",
      aspectRatio,
      fit: "cover",
      worldSize: [0, 0],
      origin: [0.5, 0.5],
      offset: [0, 0],
      scale: 1,
      rotationDegrees: 0,
      sampling: defaultSampling
        ? { ...defaultSampling }
        : { min: "linear", mag: "linear", mipmap: "none" },
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function bounded(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function pair(
  value: unknown,
  min: number,
  max: number,
): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => bounded(part, min, max))
  );
}

export function isNativeSourceSizing(
  value: unknown,
): value is NativeSourceSizing {
  if (
    !record(value) ||
    !exactKeys(value, [
      "inputSpace",
      "aspectRatio",
      "fit",
      "worldSize",
      "origin",
      "offset",
      "scale",
      "rotationDegrees",
      "sampling",
    ])
  )
    return false;
  if (
    !record(value.sampling) ||
    !exactKeys(value.sampling, ["min", "mag", "mipmap"])
  )
    return false;
  return (
    (value.inputSpace === "intrinsic-image" ||
      value.inputSpace === "rendered-surface") &&
    bounded(value.aspectRatio, 1 / 64, 64) &&
    (value.fit === "none" ||
      value.fit === "contain" ||
      value.fit === "cover") &&
    pair(value.worldSize, 0, 16_384) &&
    pair(value.origin, 0, 1) &&
    pair(value.offset, -1, 1) &&
    bounded(value.scale, 0.1, 4) &&
    bounded(value.rotationDegrees, 0, 360) &&
    (value.sampling.min === "nearest" || value.sampling.min === "linear") &&
    (value.sampling.mag === "nearest" || value.sampling.mag === "linear") &&
    (value.sampling.mipmap === "none" ||
      value.sampling.mipmap === "nearest" ||
      value.sampling.mipmap === "linear")
  );
}
