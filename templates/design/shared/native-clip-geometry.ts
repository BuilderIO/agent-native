export interface NativeClipCorner {
  x: number;
  y: number;
}

export interface NativeClipRadii {
  topLeft: NativeClipCorner;
  topRight: NativeClipCorner;
  bottomRight: NativeClipCorner;
  bottomLeft: NativeClipCorner;
}

export interface NativeClipRadiusInput {
  width: number;
  height: number;
  cssPixelScale: number;
  topLeft: string;
  topRight: string;
  bottomRight: string;
  bottomLeft: string;
}

export type NativeClipRadiusResult =
  | { ok: true; radii: NativeClipRadii }
  | { ok: false; reason: "unsupported" | "unreadable"; detail: string };

type ParsedLength = { value: number; unit: "px" | "%" };
type LengthResult =
  | { ok: true; length: ParsedLength }
  | { ok: false; reason: "unsupported" | "unreadable" };
type CornerResult =
  | { ok: true; corner: NativeClipCorner }
  | { ok: false; reason: "unsupported" | "unreadable"; detail: string };

const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(px|%)?$/;
const DIMENSION = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[a-z]+$/i;
const CSS_FUNCTION = /(?:calc|min|max|clamp|var|env)\(/i;

function parseLength(value: string): LengthResult {
  const match = LENGTH.exec(value);
  if (!match) {
    return {
      ok: false,
      reason:
        DIMENSION.test(value) || CSS_FUNCTION.test(value)
          ? "unsupported"
          : "unreadable",
    };
  }
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number < 0) {
    return { ok: false, reason: "unreadable" };
  }
  const unit = match[2];
  if (unit === "px" || unit === "%") {
    return { ok: true, length: { value: number, unit } };
  }
  return number === 0
    ? { ok: true, length: { value: 0, unit: "px" } }
    : { ok: false, reason: "unreadable" };
}

function parseCorner(
  value: string,
  width: number,
  height: number,
  cssPixelScale: number,
): CornerResult {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      reason: "unreadable",
      detail: "Computed corner radius is missing.",
    };
  }

  const parts = value.trim().split(/\s+/);
  if (parts.length > 2) {
    return {
      ok: false,
      reason: CSS_FUNCTION.test(value) ? "unsupported" : "unreadable",
      detail: `Cannot resolve computed corner radius: ${value}`,
    };
  }
  const horizontal = parseLength(parts[0]!);
  const vertical = parseLength(parts[1] ?? parts[0]!);
  if (!horizontal.ok) {
    return {
      ok: false,
      reason: horizontal.reason,
      detail: `Cannot resolve computed corner radius: ${value}`,
    };
  }
  if (!vertical.ok) {
    return {
      ok: false,
      reason: vertical.reason,
      detail: `Cannot resolve computed corner radius: ${value}`,
    };
  }

  const x =
    horizontal.length.unit === "%"
      ? (horizontal.length.value / 100) * width
      : horizontal.length.value * cssPixelScale;
  const y =
    vertical.length.unit === "%"
      ? (vertical.length.value / 100) * height
      : vertical.length.value * cssPixelScale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `Computed corner radius exceeds finite geometry: ${value}`,
    };
  }
  return { ok: true, corner: { x, y } };
}

export function resolveNativeClipRadii(
  input: NativeClipRadiusInput,
): NativeClipRadiusResult {
  const { width, height, cssPixelScale } = input;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(cssPixelScale) ||
    width < 0 ||
    height < 0 ||
    cssPixelScale <= 0
  ) {
    return {
      ok: false,
      reason: "unreadable",
      detail: "Clip dimensions or CSS pixel scale are invalid.",
    };
  }

  const topLeft = parseCorner(input.topLeft, width, height, cssPixelScale);
  if (!topLeft.ok) return topLeft;
  const topRight = parseCorner(input.topRight, width, height, cssPixelScale);
  if (!topRight.ok) return topRight;
  const bottomRight = parseCorner(
    input.bottomRight,
    width,
    height,
    cssPixelScale,
  );
  if (!bottomRight.ok) return bottomRight;
  const bottomLeft = parseCorner(
    input.bottomLeft,
    width,
    height,
    cssPixelScale,
  );
  if (!bottomLeft.ok) return bottomLeft;

  const radii: NativeClipRadii = {
    topLeft: topLeft.corner,
    topRight: topRight.corner,
    bottomRight: bottomRight.corner,
    bottomLeft: bottomLeft.corner,
  };
  const sides = [
    [width, radii.topLeft.x + radii.topRight.x],
    [height, radii.topRight.y + radii.bottomRight.y],
    [width, radii.bottomRight.x + radii.bottomLeft.x],
    [height, radii.bottomLeft.y + radii.topLeft.y],
  ] as const;
  if (sides.some(([, sum]) => !Number.isFinite(sum))) {
    return {
      ok: false,
      reason: "unreadable",
      detail: "Adjacent corner radii exceed finite geometry.",
    };
  }
  const factor = sides.reduce(
    (minimum, [length, sum]) =>
      sum > 0 ? Math.min(minimum, length / sum) : minimum,
    1,
  );
  if (factor === 1) return { ok: true, radii };
  return {
    ok: true,
    radii: {
      topLeft: { x: radii.topLeft.x * factor, y: radii.topLeft.y * factor },
      topRight: {
        x: radii.topRight.x * factor,
        y: radii.topRight.y * factor,
      },
      bottomRight: {
        x: radii.bottomRight.x * factor,
        y: radii.bottomRight.y * factor,
      },
      bottomLeft: {
        x: radii.bottomLeft.x * factor,
        y: radii.bottomLeft.y * factor,
      },
    },
  };
}
