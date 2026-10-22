import type {
  Slides2ImageCropRect,
  Slides2ImageCropResult,
} from "./Slides2ImageCropControls";

export type ImageCropStyleEdit = {
  key: "objectFit" | "objectPosition" | "objectViewBox";
  value: string | null;
};

export function imageCropStyleEdits(
  result: Slides2ImageCropResult,
): ImageCropStyleEdit[] {
  return [
    { key: "objectFit", value: result.fit },
    { key: "objectPosition", value: "50% 50%" },
    {
      key: "objectViewBox",
      value:
        result.fit === "cover" ? cropRectToObjectViewBox(result.rect) : null,
    },
  ];
}

export function cropRectToObjectViewBox(rect: Slides2ImageCropRect): string {
  const top = round2(rect.y);
  const left = round2(rect.x);
  const right = round2(100 - rect.x - rect.width);
  const bottom = round2(100 - rect.y - rect.height);
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

export function objectViewBoxToCropRect(
  value: string | undefined,
): Slides2ImageCropRect | null {
  const match = value?.trim().match(/^inset\(([^)]+)\)$/i);
  if (!match?.[1]) return null;

  const values = match[1].trim().split(/\s+/).map(parsePercent);
  if (values.some((part) => part === null)) return null;

  let top: number;
  let right: number;
  let bottom: number;
  let left: number;
  if (values.length === 1) {
    top = right = bottom = left = values[0]!;
  } else if (values.length === 2) {
    top = bottom = values[0]!;
    right = left = values[1]!;
  } else if (values.length === 3) {
    top = values[0]!;
    right = left = values[1]!;
    bottom = values[2]!;
  } else if (values.length === 4) {
    [top, right, bottom, left] = values as [number, number, number, number];
  } else {
    return null;
  }

  const width = 100 - left - right;
  const height = 100 - top - bottom;
  if (
    [top, right, bottom, left].some((part) => part < 0 || part > 100) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x: left, y: top, width, height };
}

function parsePercent(value: string): number | null {
  const match = value.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
