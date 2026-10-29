/**
 * Where a shape inside an inline `<svg>` sits. CSS insets do nothing on SVG
 * geometry, so the editor moves a shape with its CSS `translate`: the browser
 * applies it outside the shape's own `transform`, in its parent's user units,
 * which leaves the authored geometry and `transform` attribute untouched.
 */

export interface SvgLinearMap {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface SvgShapeOffset {
  x: number;
  y: number;
}

// Graphics elements a `translate` places. `tspan` and `textPath` follow their
// `<text>`, and resources only paint through what references them.
const MOVABLE_SVG_SHAPE_TAGS = new Set([
  "circle",
  "ellipse",
  "g",
  "image",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "svg",
  "text",
  "use",
]);

export function isMovableSvgShapeTag(tagName: string): boolean {
  return MOVABLE_SVG_SHAPE_TAGS.has(tagName.toLowerCase());
}

const PX_TOKEN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i;

/**
 * Reads a CSS `translate` as user-unit x/y. Returns null for a value the
 * editor cannot add a distance to: percentages, other units, or a z offset.
 */
export function parseSvgShapeTranslate(
  value: string | null | undefined,
): SvgShapeOffset | null {
  const raw = (value ?? "").trim();
  if (!raw || raw === "none") return { x: 0, y: 0 };
  const tokens = raw.split(/\s+/);
  if (tokens.length > 3 || !tokens.every((token) => PX_TOKEN.test(token))) {
    return null;
  }
  const [x = 0, y = 0, z = 0] = tokens.map((token) => Number.parseFloat(token));
  if (![x, y, z].every(Number.isFinite) || z !== 0) return null;
  return { x, y };
}

export function formatSvgShapeTranslate(offset: SvgShapeOffset): string {
  const px = (value: number) => `${Number(value.toFixed(2)) || 0}px`;
  return `${px(offset.x)} ${px(offset.y)}`;
}

/**
 * The `translate` that moves a shape by a canvas distance. `toCanvas` maps the
 * parent's user units to canvas px; null when it cannot be inverted.
 */
export function svgShapeTranslateAfterMove(
  offset: SvgShapeOffset,
  toCanvas: SvgLinearMap,
  distance: { dx: number; dy: number },
): string | null {
  const { a, b, c, d } = toCanvas;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  return formatSvgShapeTranslate({
    x: offset.x + (d * distance.dx - c * distance.dy) / determinant,
    y: offset.y + (-b * distance.dx + a * distance.dy) / determinant,
  });
}
