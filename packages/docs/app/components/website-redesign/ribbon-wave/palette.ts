/**
 * The sheet samples a square palette by its own (u, v): u runs across the
 * fold (the seam is at u = 0.5) and v along the ribbon. This paints that
 * palette from brand colours as soft blobs, so no image asset ships.
 */
export interface RibbonPaletteColors {
  /** Pale outer edges and the fold seam. */
  edge: string;
  /** Cream wash through the middle. */
  light: string;
  /** The dominant band near the leading edge. */
  primary: string;
  /** The ground most of the sheet sits on. */
  secondary: string;
  /** Low warm patch on the back face. */
  accent: string;
  /** Small saturated pockets and the bottom corners. */
  deep: string;
}

export const RIBBON_PALETTE_ROLES = [
  "edge",
  "light",
  "primary",
  "secondary",
  "accent",
  "deep",
] as const satisfies readonly (keyof RibbonPaletteColors)[];

type Role = keyof RibbonPaletteColors;

interface Blob {
  role: Role;
  x: number;
  y: number;
  rx: number;
  ry: number;
  strength?: number;
}

// Positions are fractions of the palette, top-left origin (v = 1 at the top).
const BLOBS: readonly Blob[] = [
  { role: "primary", x: 0.25, y: 0.16, rx: 0.16, ry: 0.24 },
  { role: "primary", x: 0.34, y: 0.42, rx: 0.1, ry: 0.12, strength: 0.7 },
  { role: "light", x: 0.36, y: 0.55, rx: 0.15, ry: 0.2 },
  { role: "light", x: 0.62, y: 0.58, rx: 0.12, ry: 0.14 },
  { role: "light", x: 0.42, y: 0.86, rx: 0.12, ry: 0.12, strength: 0.8 },
  { role: "secondary", x: 0.12, y: 0.55, rx: 0.14, ry: 0.22 },
  { role: "secondary", x: 0.56, y: 0.2, rx: 0.16, ry: 0.16 },
  { role: "secondary", x: 0.8, y: 0.38, rx: 0.12, ry: 0.14 },
  { role: "deep", x: 0.72, y: 0.5, rx: 0.08, ry: 0.09 },
  { role: "deep", x: 0.9, y: 0.16, rx: 0.06, ry: 0.1 },
  { role: "deep", x: 0.1, y: 0.95, rx: 0.14, ry: 0.1 },
  { role: "deep", x: 0.86, y: 0.93, rx: 0.14, ry: 0.1 },
  { role: "accent", x: 0.63, y: 0.8, rx: 0.12, ry: 0.12 },
];

const SIZE = 256;

export function readRibbonPalette(
  style: CSSStyleDeclaration,
  prefix: string,
): RibbonPaletteColors | null {
  const colors = {} as RibbonPaletteColors;
  for (const role of RIBBON_PALETTE_ROLES) {
    const value = style.getPropertyValue(`${prefix}${role}`).trim();
    if (!value) return null;
    colors[role] = value;
  }
  return colors;
}

/**
 * Paint pale tints: the sheet squares its colour on output, which deepens
 * them into the saturated bands.
 */
export function paintRibbonPalette(
  colors: RibbonPaletteColors,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable for the ribbon palette");

  const encoded = {} as Record<Role, [number, number, number]>;
  for (const role of RIBBON_PALETTE_ROLES) {
    encoded[role] = parseColor(ctx, colors[role]);
  }
  const rgba = (role: Role, alpha: number) => {
    const [r, g, b] = encoded[role];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  ctx.fillStyle = rgba("secondary", 1);
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (const blob of BLOBS) {
    const alpha = blob.strength ?? 1;
    ctx.save();
    ctx.translate(blob.x * SIZE, blob.y * SIZE);
    ctx.scale(blob.rx * SIZE, blob.ry * SIZE);
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    fill.addColorStop(0, rgba(blob.role, alpha));
    fill.addColorStop(0.45, rgba(blob.role, alpha * 0.75));
    fill.addColorStop(1, rgba(blob.role, 0));
    ctx.fillStyle = fill;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  const sideWidth = SIZE * 0.12;
  const left = ctx.createLinearGradient(0, 0, sideWidth, 0);
  left.addColorStop(0, rgba("edge", 0.95));
  left.addColorStop(1, rgba("edge", 0));
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, sideWidth, SIZE);

  const right = ctx.createLinearGradient(SIZE, 0, SIZE - sideWidth, 0);
  right.addColorStop(0, rgba("edge", 0.95));
  right.addColorStop(1, rgba("edge", 0));
  ctx.fillStyle = right;
  ctx.fillRect(SIZE - sideWidth, 0, sideWidth, SIZE);

  const seamWidth = SIZE * 0.04;
  const seam = ctx.createLinearGradient(
    SIZE / 2 - seamWidth / 2,
    0,
    SIZE / 2 + seamWidth / 2,
    0,
  );
  seam.addColorStop(0, rgba("edge", 0));
  seam.addColorStop(0.5, rgba("edge", 0.7));
  seam.addColorStop(1, rgba("edge", 0));
  ctx.fillStyle = seam;
  ctx.fillRect(SIZE / 2 - seamWidth / 2, 0, seamWidth, SIZE);

  return canvas;
}

function parseColor(
  ctx: CanvasRenderingContext2D,
  color: string,
): [number, number, number] {
  // An invalid colour would silently leave the previous fill in place.
  if (!CSS.supports("color", color)) {
    throw new Error(`Ribbon palette colour "${color}" is not a CSS colour`);
  }
  ctx.fillStyle = color;
  const resolved = ctx.fillStyle;
  const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(resolved);
  const parsed = channels
    ? channels.slice(1).map((hex) => parseInt(hex, 16))
    : /rgba?\(([^)]+)\)/
        .exec(resolved)?.[1]
        ?.split(",")
        .slice(0, 3)
        .map((part) => Number(part.trim()));
  if (!parsed || parsed.length !== 3 || parsed.some(Number.isNaN)) {
    throw new Error(`Ribbon palette colour "${color}" could not be parsed`);
  }
  return parsed as [number, number, number];
}
