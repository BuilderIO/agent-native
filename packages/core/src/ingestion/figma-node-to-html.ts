/**
 * Figma node JSON -> HTML mapper.
 *
 * Input is the `document` subtree returned by
 * `GET /v1/files/:fileKey/nodes?ids=...&geometry=paths` (or the file's root
 * `document` node). Output is a self-contained HTML fragment using absolute
 * positioning + inline styles, matching Figma's own canvas model 1:1 rather
 * than reconstructing a semantic/Tailwind layout — the goal is pixel fidelity
 * for an imported snapshot, not idiomatic hand-authored markup.
 *
 * This module is pure and synchronous: it never calls the network. The
 * caller (an action) is responsible for:
 *   1. Fetching the node JSON from the Figma REST API.
 *   2. Calling `collectFallbackNodeIds` / `collectImageFillRefs` to find out
 *      which nodes need a rendered PNG fallback and which image fills need
 *      resolved URLs.
 *   3. Fetching those via `/v1/images/:fileKey` (fallback renders) and
 *      `/v1/files/:fileKey/images` (fill ref -> URL map).
 *   4. Calling `mapFigmaNodeToHtml` with the resulting maps.
 *
 * ## Pixel-perfect property coverage
 *
 * | Property                                   | Fidelity      | Notes |
 * | ------------------------------------------- | ------------- | ----- |
 * | Position/size (absoluteBoundingBox)         | exact         | frame-relative |
 * | Auto-layout (flex*)                         | exact         | Figma auto-layout IS flexbox |
 * | Text font/size/weight/case/decoration/align | exact         | |
 * | Line-height (px vs percent-of-font-size)    | exact         | resolved to px |
 * | Letter-spacing                              | exact         | already px in REST API |
 * | Solid fills                                 | exact         | |
 * | Gradient fills (angle/position)              | exact (linear)/approximated (radial/angular/diamond) | derived from gradientHandlePositions, not a default angle |
 * | Multiple fills (layering)                    | exact         | reversed to match CSS background-image stacking |
 * | Image fills (scale modes)                    | exact (FILL/FIT/TILE/STRETCH-axis-aligned) / approximated (skewed imageTransform) | |
 * | Per-paint opacity                            | exact         | folded into color/stop alpha; IMAGE paints become an overlay div (CSS background layers have no per-layer opacity) |
 * | Per-paint blend mode                         | image fallback | a non-NORMAL paint blendMode escalates the whole node to a rendered PNG (see `needsImageFallback`) |
 * | Strokes (uniform, align)                     | exact         | CENTER via outline+negative offset, INSIDE via inset box-shadow, OUTSIDE via outline |
 * | Strokes (per-side weights)                   | approximated  | CSS has no per-side outline; falls back to per-side `border` (inside-only) |
 * | Corner radii (uniform + per-corner)          | exact         | |
 * | Effects: drop/inner shadow                   | exact         | |
 * | Effects: layer/background blur               | approximated  | CSS blur() = 0.45x the Figma radius, fitted against Figma's own renders (see FIGMA_BLUR_RADIUS_TO_CSS_BLUR) |
 * | Opacity                                      | exact         | |
 * | Blend modes (CSS-supported)                   | exact         | |
 * | Blend modes (Figma-only: LINEAR_BURN/DODGE/LIGHTER/DARKER) | approximated | mapped to closest CSS equivalent |
 * | clipsContent                                  | exact        | overflow: hidden |
 * | Rotation                                      | approximated | pivots about the bounding-box center (see below) |
 * | Vectors / boolean ops WITH `fillGeometry` (geometry=paths) | exact | inline `<svg><path>`, real editable geometry |
 * | Vectors / boolean ops / unsupported types WITHOUT geometry | image fallback | never approximated structurally |
 *
 * ### Rotation caveat
 * The REST API docs describe `rotation` as being in degrees, but the field
 * is empirically returned in RADIANS (verified against known authored
 * rotations via the Plugin API); this mapper converts it to degrees before
 * use. `absoluteBoundingBox` is the *already-rotated* axis-aligned bounding
 * box —
 * Figma does not expose the pre-rotation box directly. We reconstruct the
 * unrotated box by treating the AABB's center as invariant under rotation
 * (true for a shape rotated about its own center) and rotate the CSS element
 * about `transform-origin: center` by `rotation` degrees.
 *
 * The sign is NOT flipped: `relativeTransform`'s 2x2 block is exactly CSS's
 * own `[[cos a, -sin a], [sin a, cos a]]` in the same y-down screen space.
 * The `Rotated Radial` node in the `parity-stress` corpus frame reports
 * `rotation: -0.2967` (= -17deg) with `relativeTransform`
 * `[[0.9563, 0.2924, ...], [-0.2924, 0.9563, ...]]`, which solves to
 * a = -17deg; `Masked Diamond Gradient` reports +9deg and solves to +9deg.
 * Negating it (as this mapper did until the fidelity harness rendered that
 * frame side by side) tilts every rotated node the wrong way by 2x the angle.
 *
 * This is exact when Figma pivots rotation about the shape's center and only
 * approximated if Figma's internal pivot differs (rare in practice; visually
 * indistinguishable in the overwhelming majority of designs). A fully exact
 * alternative would consume `relativeTransform` as a CSS `matrix()` directly,
 * which is a documented follow-up if a specific design surfaces a visible
 * mismatch.
 */

import {
  cssBlendMode,
  gradientAngleDegrees as gradientAngleDegreesMath,
  gradientRayAngleDegreesFromHandles,
  remapLinearStopPosition as remapLinearStopPositionMath,
  resolveGradientHandles,
  vectorLength,
  type GradientHandles,
} from "./figma-paint-math.js";

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
}

export interface FigmaImageFilter {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

export interface FigmaPaint {
  type:
    | "SOLID"
    | "GRADIENT_LINEAR"
    | "GRADIENT_RADIAL"
    | "GRADIENT_ANGULAR"
    | "GRADIENT_DIAMOND"
    | "IMAGE"
    | "EMOJI"
    | "VIDEO";
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientHandlePositions?: Array<{ x: number; y: number }>;
  gradientStops?: FigmaColorStop[];
  imageRef?: string;
  scaleMode?: "FILL" | "FIT" | "TILE" | "STRETCH";
  imageTransform?: [[number, number, number], [number, number, number]];
  filters?: FigmaImageFilter;
  blendMode?: string;
}

export interface FigmaEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  visible?: boolean;
  radius?: number;
  spread?: number;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  blendMode?: string;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: "PIXELS" | "FONT_SIZE_%" | "INTRINSIC_%";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textAlignHorizontal?: "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  hangingPunctuation?: boolean;
  hangingList?: boolean;
  opentypeFlags?: Record<string, number>;
  hyperlink?: unknown;
  fills?: FigmaPaint[];
}

/**
 * One flattened vector path as returned by
 * `GET /v1/files/:key/nodes?...&geometry=paths`. `path` is SVG path data in
 * the node's own coordinate space (origin = the node's `absoluteBoundingBox`
 * top-left). `strokeGeometry` entries are the stroke *already outlined into a
 * fillable region*, not a centerline to re-stroke.
 */
export interface FigmaVectorPath {
  path?: string;
  windingRule?: "NONZERO" | "EVENODD" | "NONE";
}

export interface FigmaIndividualStrokeWeights {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface FigmaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  rotation?: number;
  absoluteBoundingBox?: FigmaBoundingBox;
  relativeTransform?: [[number, number, number], [number, number, number]];
  /**
   * The node's actual visual extent, INCLUDING stroke/effect overflow --
   * e.g. an OUTSIDE-aligned stroke or a drop shadow makes this larger than
   * `absoluteBoundingBox` (the purely geometric fill bounds). Figma's own
   * `/v1/images` renders for a node are cropped to this box, not to
   * `absoluteBoundingBox` -- sizing an image-fallback `<img>` using the
   * geometric box instead squishes/crops the rendered PNG to the wrong
   * aspect ratio whenever a fallback node has stroke/effect overflow.
   */
  absoluteRenderBounds?: FigmaBoundingBox;
  size?: { x: number; y: number };
  clipsContent?: boolean;
  isMask?: boolean;
  maskType?: "ALPHA" | "VECTOR" | "LUMINANCE";
  arcData?: {
    startingAngle?: number;
    endingAngle?: number;
    innerRadius?: number;
  };
  characters?: string;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  lineTypes?: string[];
  lineIndentations?: number[];
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  individualStrokeWeights?: FigmaIndividualStrokeWeights;
  strokeDashes?: number[];
  fillGeometry?: FigmaVectorPath[];
  strokeGeometry?: FigmaVectorPath[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  /** Older spelling of main-axis sizing; still present in real community files. */
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  layoutWrap?: "NO_WRAP" | "WRAP";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  componentId?: string;
  componentProperties?: Record<string, unknown>;
  boundVariables?: Record<string, unknown>;
  interactions?: unknown[];
  children?: FigmaNode[];
}

export type FidelityLevel = "exact" | "approximated" | "image-fallback";

export interface FidelityEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  level: FidelityLevel;
  notes: string[];
}

export interface FidelityReport {
  entries: FidelityEntry[];
  summary: {
    exact: number;
    approximated: number;
    imageFallback: number;
  };
}

export interface MapFigmaNodeOptions {
  /** imageRef hash -> resolved public URL, from `/v1/files/:key/images`. */
  imageFillUrls?: Record<string, string>;
  /**
   * imageRef hash -> the image's own pixel size. Figma upscales an image fill
   * with NEAREST-NEIGHBOUR sampling; a browser upscales with bilinear
   * smoothing. Measured across a checkerboard edge on a 16x16 fill blown up to
   * 180x90, Figma steps from 119,73,132 to 227,78,52 in ONE pixel
   * while the browser ramps across twelve. Supplying the size lets the
   * converter ask for the same sampling; without it the fill still renders,
   * just smoothed.
   */
  imageFillSizes?: Record<string, { width: number; height: number }>;
  /** nodeId -> rendered PNG URL, from `/v1/images/:key` for fallback subtrees. */
  fallbackImageUrls?: Record<string, string>;
  /** Node ids that should be rendered as an image regardless of type. */
  forceImageFallbackNodeIds?: Set<string>;
}

export interface MapFigmaNodeResult {
  html: string;
  fidelity: FidelityReport;
}

const UNSUPPORTED_STRUCTURAL_TYPES = new Set([
  "BOOLEAN_OPERATION",
  "VECTOR",
  "STAR",
  "REGULAR_POLYGON",
  "SLICE",
  "STICKY",
  "SHAPE_WITH_TEXT",
  "CONNECTOR",
  "WASHI_TAPE",
  "TABLE",
]);

const SUPPORTED_CONTAINER_TYPES = new Set([
  "FRAME",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
]);

const MAX_FIGMA_NODE_COUNT = 75_000;
const MAX_FIGMA_NODE_DEPTH = 256;
const MAX_METADATA_ATTRIBUTE_CHARS = 16_384;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function px(value: number | undefined, precision = 2): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return `${round(value, precision)}px`;
}

function colorToCss(
  color: FigmaColor | undefined,
  opacityMul = 1,
): string | null {
  if (!color) return null;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  const a = round((color.a ?? 1) * opacityMul, 4);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function metadataAttr(
  name: string,
  value: unknown,
  node: FigmaNode,
  tracker: FidelityTracker,
): string {
  if (value === undefined || value === null) return "";
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    tracker.record(
      node,
      "approximated",
      `${name} metadata could not be serialized and was omitted.`,
    );
    return "";
  }
  if (serialized.length > MAX_METADATA_ATTRIBUTE_CHARS) {
    tracker.record(
      node,
      "approximated",
      `${name} metadata exceeded ${MAX_METADATA_ATTRIBUTE_CHARS} characters and was omitted.`,
    );
    return "";
  }
  return ` ${name}="${escapeAttr(serialized)}"`;
}

/**
 * Builds the CSS text for a `style="..."` attribute AND escapes it for HTML
 * attribute context. This matters because at least one style value we emit
 * legitimately contains a literal double-quote character: font-family values
 * are built as `"Inter", sans-serif` (CSS requires quoting family names with
 * spaces). Without escaping here, that embedded `"` prematurely terminates
 * the enclosing `style="..."` attribute the moment a browser (or any other
 * HTML parser) reads it -- silently dropping every style declared after
 * font-family in object-key order (font-size, font-weight, line-height,
 * text-align, and the text node's own `display: flex` used to emulate
 * vertical alignment). The visible symptom is text rendering at the
 * browser's default font/size instead of the mapped Figma typography, with
 * no error anywhere -- caught here via a real headless-browser render that
 * showed a Figma TEXT node's own style attribute silently truncated at
 * `font-family: "`.
 */
function styleAttr(styles: Record<string, string | undefined>): string {
  const parts = Object.entries(styles)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}: ${value}`);
  return escapeAttr(parts.join("; "));
}

// ---------------------------------------------------------------------------
// Fidelity report builder
// ---------------------------------------------------------------------------

class FidelityTracker {
  private entries = new Map<string, FidelityEntry>();

  record(node: FigmaNode, level: FidelityLevel, note: string) {
    const existing = this.entries.get(node.id);
    if (existing) {
      // Never downgrade an image-fallback entry, and never upgrade below the
      // worst level recorded for this node.
      const rank: Record<FidelityLevel, number> = {
        exact: 0,
        approximated: 1,
        "image-fallback": 2,
      };
      if (rank[level] > rank[existing.level]) existing.level = level;
      existing.notes.push(note);
      return;
    }
    this.entries.set(node.id, {
      nodeId: node.id,
      nodeName: node.name ?? node.id,
      nodeType: node.type,
      level,
      notes: [note],
    });
  }

  build(): FidelityReport {
    const entries = [...this.entries.values()];
    const summary = entries.reduce(
      (acc, entry) => {
        if (entry.level === "exact") acc.exact += 1;
        else if (entry.level === "approximated") acc.approximated += 1;
        else acc.imageFallback += 1;
        return acc;
      },
      { exact: 0, approximated: 0, imageFallback: 0 },
    );
    return { entries, summary };
  }
}

// ---------------------------------------------------------------------------
// Gradient angle / position derivation
// ---------------------------------------------------------------------------

function resolveGradientGeometry(paint: FigmaPaint): GradientHandles | null {
  return resolveGradientHandles(paint.gradientHandlePositions);
}

/**
 * Derive a CSS `linear-gradient()` angle (degrees) from Figma's normalized
 * `gradientHandlePositions`. Handle positions are normalized independently in
 * x and y (0..1 relative to the node's bounding box), so the angle must be
 * computed in actual pixel space using the node's real width/height —
 * otherwise a non-square box silently distorts the angle.
 *
 * Verified against Figma's documented identity handles
 * (start=(0,0.5), end=(1,0.5), width=(1,0), i.e. a plain left-to-right
 * gradient) which must resolve to CSS `90deg` ("to right"):
 *   dx = 1*w, dy = 0  -> atan2(0, dx) = 0deg -> +90 = 90deg. Matches.
 * And a top-to-bottom gradient (start=(0.5,0), end=(0.5,1)) must resolve to
 * CSS `180deg` ("to bottom"):
 *   dx = 0, dy = 1*h -> atan2(dy, 0) = 90deg -> +90 = 180deg. Matches.
 */
export function gradientAngleDegrees(
  paint: FigmaPaint,
  box: { width: number; height: number },
): number | null {
  return gradientAngleDegreesMath(paint, box);
}

function gradientStopsCss(
  paint: FigmaPaint,
  remapPosition?: (position: number) => number,
): string {
  const stops = paint.gradientStops ?? [];
  return stops
    .map((stop) => {
      const color = colorToCss(stop.color, paint.opacity ?? 1) ?? "transparent";
      const position = remapPosition
        ? remapPosition(stop.position)
        : stop.position;
      return `${color} ${round(position * 100, 2)}%`;
    })
    .join(", ");
}

function remapLinearStopPosition(
  geometry: GradientHandles,
  box: { width: number; height: number },
  angleDeg: number,
): (position: number) => number {
  return remapLinearStopPositionMath(geometry, box, angleDeg);
}

/**
 * Convert one Figma paint layer to a CSS `background-image` value (or plain
 * color for a SOLID paint used standalone). Returns null for paints that
 * cannot be expressed as a background-image (handled elsewhere).
 */
function paintToCssImage(
  paint: FigmaPaint,
  box: { width: number; height: number },
  tracker: FidelityTracker,
  node: FigmaNode,
): string | null {
  if (paint.visible === false) return null;
  const stops = gradientStopsCss(paint);
  if (!stops) return null;

  switch (paint.type) {
    case "GRADIENT_LINEAR": {
      const angle = gradientAngleDegrees(paint, box);
      const geometry = resolveGradientGeometry(paint);
      // Re-express Figma's handle-relative stop positions as percentages of
      // CSS's own full-box gradient line (see remapLinearStopPosition) so a
      // gradient whose handles don't span exactly corner-to-corner still
      // lands its color transitions at the same real pixel positions Figma
      // draws them at, instead of being stretched to fill the whole box.
      const linearStops =
        angle !== null && geometry
          ? gradientStopsCss(
              paint,
              remapLinearStopPosition(geometry, box, angle),
            )
          : stops;
      tracker.record(
        node,
        "exact",
        "Linear gradient angle and stop offsets derived from gradientHandlePositions.",
      );
      return `linear-gradient(${round(angle ?? 90, 2)}deg, ${linearStops})`;
    }
    case "GRADIENT_RADIAL": {
      const geometry = resolveGradientGeometry(paint);
      if (!geometry) return `radial-gradient(${stops})`;
      const cx = round(geometry.start.x * 100, 2);
      const cy = round(geometry.start.y * 100, 2);
      // Figma's handle[1] ("end") is the radius vector along the gradient's
      // own primary axis; handle[2] ("width") is the perpendicular radius.
      // For an axis-aligned box those map directly to the ellipse's
      // horizontal/vertical radii -- swapping them (as a prior version of
      // this code did) silently rotates the ellipse 90 degrees, which is
      // invisible for a square box but produces a badly wrong bowtie-shaped
      // gradient for any non-square rectangle (the common case).
      const radiusX = vectorLength(geometry.start, geometry.end, box);
      const radiusY = vectorLength(geometry.start, geometry.width, box);
      tracker.record(
        node,
        "approximated",
        "Radial gradient rendered as an axis-aligned ellipse sized from gradientHandlePositions; rotated/skewed radial gradients are not expressible in CSS radial-gradient().",
      );
      return `radial-gradient(ellipse ${round(radiusX, 2)}px ${round(radiusY, 2)}px at ${cx}% ${cy}%, ${stops})`;
    }
    case "GRADIENT_ANGULAR": {
      const geometry = resolveGradientGeometry(paint);
      const cx = geometry ? round(geometry.start.x * 100, 2) : 50;
      const cy = geometry ? round(geometry.start.y * 100, 2) : 50;
      // A conic gradient's `from` angle aims at the end *handle* (a point), so
      // it scales like a position -- not like the linear gradient's iso-line
      // normal, which scales by the inverse. See the two angle helpers in
      // figma-paint-math.
      const fromAngle = geometry
        ? gradientRayAngleDegreesFromHandles(geometry, box)
        : 0;
      tracker.record(
        node,
        "exact",
        "Conic (angular) gradient start angle derived from the centre->end handle ray, and swept in the node's normalized space as Figma does — drawn into a square and scaled to the box, so a non-square box keeps its mid-sweep stop positions.",
      );
      return `conic-gradient(from ${round(fromAngle ?? 0, 2)}deg at ${cx}% ${cy}%, ${stops})`;
    }
    case "GRADIENT_DIAMOND": {
      const geometry = resolveGradientGeometry(paint);
      const cx = geometry ? round(geometry.start.x * 100, 2) : 50;
      const cy = geometry ? round(geometry.start.y * 100, 2) : 50;
      // Same handle-to-axis mapping fix as GRADIENT_RADIAL above: handle[1]
      // ("end") is the primary-axis radius, handle[2] ("width") the
      // perpendicular one.
      const radiusX = geometry
        ? vectorLength(geometry.start, geometry.end, box)
        : box.width / 2;
      const radiusY = geometry
        ? vectorLength(geometry.start, geometry.width, box)
        : box.height / 2;
      tracker.record(
        node,
        "approximated",
        "Diamond gradient has no CSS equivalent; approximated as an axis-aligned elliptical radial-gradient sized from gradientHandlePositions. True diamond (rotated-square) falloff is not reproduced.",
      );
      return `radial-gradient(ellipse ${round(radiusX, 2)}px ${round(radiusY, 2)}px at ${cx}% ${cy}%, ${stops})`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Fills -> background
// ---------------------------------------------------------------------------

interface BackgroundResult {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  /** `pixelated` when a fill is magnified; see `imageFillSizes`. */
  imageRendering?: string;
  /**
   * Paint layers that cannot live in the CSS background stack (see
   * `buildFills`), emitted as absolutely-positioned child divs which must be
   * rendered *before* the node's real children so they stay beneath them.
   */
  overlayHtml?: string;
  color?: string; // for TEXT nodes, fill paints color the glyphs, not a background
}

/**
 * A diamond gradient's iso-lines are rotated rectangles: the value at a point
 * is `|dx|/rx + |dy|/ry`, an L1 distance rather than the L2 distance a radial
 * gradient draws. CSS has no diamond gradient, and approximating it with an
 * ellipse produced a soft blob where Figma draws a four-pointed star — 12% of
 * the whole fills/effects fixture came from that one tile.
 *
 * Inside a single quadrant, though, that expression is LINEAR in (dx, dy), so
 * four quadrant-sized linear gradients tiled around the centre reproduce it
 * exactly. Each tile runs at atan2(ry, rx) mirrored into its own quadrant, and
 * Figma's 0..1 stop range occupies the first half of the CSS gradient line:
 * `t` reaches 1 at the diamond's points and 2 at the tile's outer corner, so
 * the last colour holding from 50% on is Figma's own clamp, not a fudge.
 */
function diamondGradientLayers(
  paint: FigmaPaint,
  box: { width: number; height: number },
  node: FigmaNode,
  tracker: FidelityTracker,
): PaintLayer[] | null {
  const geometry = resolveGradientGeometry(paint);
  if (!geometry) return null;
  const rx = vectorLength(geometry.start, geometry.end, box);
  const ry = vectorLength(geometry.start, geometry.width, box);
  if (!(rx > 0) || !(ry > 0)) return null;
  const cx = geometry.start.x * box.width;
  const cy = geometry.start.y * box.height;
  const stops = gradientStopsCss(paint, (position) => position / 2);
  const angle = (Math.atan2(ry, rx) * 180) / Math.PI;
  const size = `${round(rx, 2)}px ${round(ry, 2)}px`;
  const quadrants = [
    { angle: 360 - angle, left: cx - rx, top: cy - ry },
    { angle, left: cx, top: cy - ry },
    { angle: 180 - angle, left: cx, top: cy },
    { angle: 180 + angle, left: cx - rx, top: cy },
  ];
  const layers: PaintLayer[] = quadrants.map((quadrant) => ({
    image: `linear-gradient(${round(quadrant.angle, 2)}deg, ${stops})`,
    size,
    position: `${round(quadrant.left, 2)}px ${round(quadrant.top, 2)}px`,
    repeat: "no-repeat",
  }));
  // The four tiles only cover the diamond's bounding box. Figma clamps to the
  // final stop everywhere beyond it, so a flat layer of that colour sits
  // underneath — without it the rest of the node would be transparent.
  const lastStop = (paint.gradientStops ?? []).at(-1);
  const clampColor = lastStop
    ? (colorToCss(lastStop.color, paint.opacity ?? 1) ?? "transparent")
    : "transparent";
  layers.push({
    image: `linear-gradient(${clampColor}, ${clampColor})`,
    size: "100% 100%",
    position: "center",
    repeat: "no-repeat",
  });
  tracker.record(
    node,
    "exact",
    "Diamond gradient reproduced as four quadrant-tiled linear gradients; its falloff is linear within each quadrant, so this is the same shape Figma draws rather than an elliptical approximation.",
  );
  return layers;
}

/** One resolved paint layer, before routing to a background layer or an overlay div. */
interface PaintLayer {
  image: string;
  size: string;
  position: string;
  repeat: string;
}

/**
 * Render an angular (conic) gradient the way Figma sweeps it.
 *
 * Figma computes the sweep in the node's NORMALIZED space — the box is treated
 * as a unit square and then stretched — while CSS `conic-gradient()` sweeps at
 * a true uniform angular rate in real pixels. On a non-square box the two
 * disagree everywhere except the axes, which is why the mid-sweep stops landed
 * visibly early on a 180x85 tile.
 *
 * Drawing the gradient into a SQUARE and scaling that square to the box
 * reproduces Figma's definition exactly rather than approximating it. The
 * outer div carries the clipping (`border-radius: inherit`), because a
 * transform on the painted div would scale the corner radii with it.
 */
function angularGradientOverlay(
  image: string,
  box: { width: number; height: number },
  paint: FigmaPaint,
): string {
  const side = box.width;
  const scaleY = side > 0 ? box.height / side : 1;
  const inner: Record<string, string | undefined> = {
    position: "absolute",
    left: "0",
    top: "0",
    width: px(side),
    height: px(side),
    transform: `scale(1, ${round(scaleY, 6)})`,
    "transform-origin": "0 0",
    "background-image": image,
    "background-size": "100% 100%",
    "background-repeat": "no-repeat",
  };
  const outer: Record<string, string | undefined> = {
    position: "absolute",
    inset: "0",
    "border-radius": "inherit",
    overflow: "hidden",
    "pointer-events": "none",
  };
  return (
    `<div data-figma-fill-layer="${escapeAttr(paint.type)}" style="${styleAttr(outer)}">` +
    `<div style="${styleAttr(inner)}"></div></div>`
  );
}

/**
 * Render one paint layer as an absolutely-positioned child div. Used for
 * layers CSS cannot express in the background stack -- today only per-paint
 * `opacity` on an IMAGE paint, which has no `background-*` equivalent.
 * `border-radius: inherit` reproduces the background stack's own clipping.
 */
function paintOverlayDiv(layer: PaintLayer, paint: FigmaPaint): string {
  // IMAGE is the only paint type whose opacity is still outstanding here:
  // `colorToCss`/`gradientStopsCss` already fold a SOLID's or a gradient's
  // opacity into its alpha channel, so re-applying it on the div would square
  // it. Only an image URL has nowhere to carry it.
  const opacity = paint.type === "IMAGE" ? (paint.opacity ?? 1) : 1;
  const styles: Record<string, string | undefined> = {
    position: "absolute",
    inset: "0",
    "border-radius": "inherit",
    "background-image": layer.image,
    "background-size": layer.size,
    "background-position": layer.position,
    "background-repeat": layer.repeat,
    opacity: opacity !== 1 ? String(round(opacity, 4)) : undefined,
    "pointer-events": "none",
  };
  return `<div data-figma-fill-layer="${escapeAttr(paint.type)}" style="${styleAttr(styles)}"></div>`;
}

function imageScaleModeCss(
  paint: FigmaPaint,
  node: FigmaNode,
  tracker: FidelityTracker,
): { size: string; position: string; repeat: string } {
  const transform = paint.imageTransform;
  const isAxisAligned =
    !transform ||
    (Math.abs(transform[0][1]) < 1e-6 && Math.abs(transform[1][0]) < 1e-6);
  if (!isAxisAligned) {
    tracker.record(
      node,
      "approximated",
      "Image fill has a non-axis-aligned imageTransform (rotated/skewed crop); approximated using the scale-mode-only CSS mapping without the transform matrix.",
    );
  }
  switch (paint.scaleMode) {
    case "FILL":
      return { size: "cover", position: "center", repeat: "no-repeat" };
    case "FIT":
      return { size: "contain", position: "center", repeat: "no-repeat" };
    case "TILE":
      return { size: "auto", position: "top left", repeat: "repeat" };
    case "STRETCH":
      return { size: "100% 100%", position: "center", repeat: "no-repeat" };
    default:
      return { size: "cover", position: "center", repeat: "no-repeat" };
  }
}

/**
 * Build the background-* properties for a node's fill stack. Figma paints
 * fills bottom-to-top (index 0 is the bottommost layer); CSS
 * `background-image` layers top-to-bottom (first value on top), so the
 * stack is reversed here to preserve visual order. A solid fill above other
 * layers is expressed as a flat `linear-gradient(color, color)` since CSS
 * `background-color` always paints *beneath every* background-image and
 * cannot be interleaved mid-stack.
 */
function buildFills(
  node: FigmaNode,
  fills: FigmaPaint[] | undefined,
  box: { width: number; height: number },
  options: MapFigmaNodeOptions,
  tracker: FidelityTracker,
  isTextNode: boolean,
): BackgroundResult {
  const visible = (fills ?? []).filter((fill) => fill.visible !== false);
  if (visible.length === 0) return {};

  if (isTextNode) {
    // Text color comes from the topmost visible SOLID fill; gradient/image
    // text fills are a CSS `background-clip: text` trick we intentionally
    // skip for now (rare in practice) and record as approximated.
    const solid = [...visible].reverse().find((fill) => fill.type === "SOLID");
    if (solid) {
      return {
        color: colorToCss(solid.color, solid.opacity ?? 1) ?? undefined,
      };
    }
    tracker.record(
      node,
      "approximated",
      "Text fill is a gradient/image, not a solid color; rendered with the default text color instead of a background-clip: text gradient.",
    );
    return {};
  }

  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];
  const overlays: string[] = [];
  let backgroundColor: string | undefined;

  // Reverse so the topmost Figma fill becomes the first (topmost) CSS layer.
  const ordered = [...visible].reverse();

  // A CSS background layer has no per-layer opacity, so an IMAGE paint with
  // `opacity` < 1 cannot be expressed in the background stack at all -- it
  // becomes an overlay div. Overlay divs paint above the whole background
  // stack, so every paint stacked *above* such an image has to move to an
  // overlay too or it would sink underneath. `ordered` is top-down, so the
  // overlay set is the prefix ending at the deepest opacity-carrying image.
  let overlayThrough = -1;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const fill = ordered[index]!;
    if (fill.type === "IMAGE" && (fill.opacity ?? 1) < 1) {
      overlayThrough = index;
      break;
    }
  }

  let magnified = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const fill = ordered[index]!;
    const isOverlay = index <= overlayThrough;
    const isBottommost = index === ordered.length - 1;

    let layer: PaintLayer | null = null;
    if (fill.type === "SOLID") {
      const color = colorToCss(fill.color, fill.opacity ?? 1);
      if (!color) continue;
      if (isBottommost && !isOverlay) {
        // A bottom-most solid always paints beneath every background-image
        // layer, so it can always become plain backgroundColor regardless of
        // how many gradient/image layers are stacked above it.
        backgroundColor = color;
        continue;
      }
      // Solid above other layers: express as a flat gradient so it stacks
      // in the correct z-order alongside gradient/image layers.
      layer = {
        image: `linear-gradient(${color}, ${color})`,
        size: "100% 100%",
        position: "center",
        repeat: "no-repeat",
      };
    } else if (fill.type === "IMAGE") {
      const url = fill.imageRef
        ? options.imageFillUrls?.[fill.imageRef]
        : undefined;
      if (!url) {
        tracker.record(
          node,
          "approximated",
          `Image fill imageRef "${fill.imageRef ?? "unknown"}" had no resolved URL; layer omitted.`,
        );
        continue;
      }
      const mode = imageScaleModeCss(fill, node, tracker);
      layer = { image: `url("${url}")`, ...mode };
      // Only when magnified: `pixelated` is nearest in BOTH directions, and a
      // photo scaled down with nearest aliases badly. A small tolerance keeps
      // a fill that is effectively 1:1 on the smooth path.
      const intrinsic = fill.imageRef
        ? options.imageFillSizes?.[fill.imageRef]
        : undefined;
      if (
        intrinsic &&
        intrinsic.width > 0 &&
        intrinsic.height > 0 &&
        (box.width > intrinsic.width * 1.2 ||
          box.height > intrinsic.height * 1.2)
      ) {
        magnified = true;
      }
    } else if (fill.type === "GRADIENT_ANGULAR") {
      // Always an overlay: the square-and-scale trick needs its own element.
      const cssImage = paintToCssImage(fill, box, tracker, node);
      if (!cssImage) continue;
      overlays.push(angularGradientOverlay(cssImage, box, fill));
      continue;
    } else if (fill.type === "GRADIENT_DIAMOND") {
      // The only paint that needs more than one CSS layer to draw correctly.
      const quadrants = diamondGradientLayers(fill, box, node, tracker);
      if (!quadrants) continue;
      if (isOverlay) {
        for (const quadrant of quadrants)
          overlays.push(paintOverlayDiv(quadrant, fill));
        continue;
      }
      for (const quadrant of quadrants) {
        images.push(quadrant.image);
        sizes.push(quadrant.size);
        positions.push(quadrant.position);
        repeats.push(quadrant.repeat);
      }
      continue;
    } else {
      const cssImage = paintToCssImage(fill, box, tracker, node);
      if (!cssImage) continue;
      layer = {
        image: cssImage,
        size: "100% 100%",
        position: "center",
        repeat: "no-repeat",
      };
    }

    if (isOverlay) {
      overlays.push(paintOverlayDiv(layer, fill));
      continue;
    }
    images.push(layer.image);
    sizes.push(layer.size);
    positions.push(layer.position);
    repeats.push(layer.repeat);
  }

  const result: BackgroundResult = {};
  if (backgroundColor) result.backgroundColor = backgroundColor;
  if (images.length > 0) {
    result.backgroundImage = images.join(", ");
    result.backgroundSize = sizes.join(", ");
    result.backgroundPosition = positions.join(", ");
    result.backgroundRepeat = repeats.join(", ");
  }
  // `image-rendering` is one property for the element, not per background
  // layer, so a single magnified fill switches the whole stack to nearest —
  // which is what Figma does too.
  if (magnified) result.imageRendering = "pixelated";
  if (overlays.length > 0) {
    // Collected top-down; DOM order paints bottom-to-top.
    result.overlayHtml = overlays.reverse().join("\n");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Strokes -> border / outline / box-shadow
// ---------------------------------------------------------------------------

interface StrokeResult {
  styles: Record<string, string | undefined>;
  insetShadow?: string;
}

function buildStrokes(node: FigmaNode, tracker: FidelityTracker): StrokeResult {
  const strokes = (node.strokes ?? []).filter(
    (stroke) => stroke.visible !== false,
  );
  if (strokes.length === 0) return { styles: {} };

  const first = strokes[0]!;
  const color =
    colorToCss(first.color, first.opacity ?? 1) ?? "rgba(0, 0, 0, 1)";
  const iw = node.individualStrokeWeights;
  const hasPerSide =
    iw &&
    (iw.top !== undefined ||
      iw.right !== undefined ||
      iw.bottom !== undefined ||
      iw.left !== undefined);
  const uniformWeight = node.strokeWeight ?? 0;

  if (hasPerSide) {
    // CSS `outline`/inset-`box-shadow` tricks are single-weight only; per-side
    // stroke weights can only be expressed as a real per-side `border`, which
    // always renders fully inside the border-box regardless of strokeAlign.
    // This is exact for INSIDE and an approximation for CENTER/OUTSIDE.
    const top = iw?.top ?? uniformWeight;
    const right = iw?.right ?? uniformWeight;
    const bottom = iw?.bottom ?? uniformWeight;
    const left = iw?.left ?? uniformWeight;
    tracker.record(
      node,
      node.strokeAlign === "INSIDE" || !node.strokeAlign
        ? "exact"
        : "approximated",
      `Per-side stroke weights rendered as CSS border (inside-aligned); strokeAlign="${node.strokeAlign ?? "INSIDE"}" cannot vary per-side with outline tricks.`,
    );
    return {
      styles: {
        "border-top": top ? `${px(top)} solid ${color}` : undefined,
        "border-right": right ? `${px(right)} solid ${color}` : undefined,
        "border-bottom": bottom ? `${px(bottom)} solid ${color}` : undefined,
        "border-left": left ? `${px(left)} solid ${color}` : undefined,
      },
    };
  }

  if (!uniformWeight) return { styles: {} };

  switch (node.strokeAlign) {
    case "OUTSIDE":
      tracker.record(
        node,
        "exact",
        "OUTSIDE stroke rendered via outline (offset 0).",
      );
      return {
        styles: {
          outline: `${px(uniformWeight)} solid ${color}`,
          "outline-offset": "0px",
        },
      };
    case "INSIDE":
      tracker.record(
        node,
        "exact",
        "INSIDE stroke rendered via inset box-shadow.",
      );
      return {
        styles: {},
        insetShadow: `inset 0 0 0 ${px(uniformWeight)} ${color}`,
      };
    case "CENTER":
    default:
      // outline-offset of -half the weight pulls the outline half inside,
      // half outside the border-box edge -- reproducing Figma's CENTER
      // straddle exactly (plain CSS `border` cannot straddle the edge).
      tracker.record(
        node,
        "exact",
        "CENTER stroke rendered via outline with outline-offset = -weight/2 (straddles the edge like Figma).",
      );
      return {
        styles: {
          outline: `${px(uniformWeight)} solid ${color}`,
          "outline-offset": px(-uniformWeight / 2),
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Corner radii
// ---------------------------------------------------------------------------

function buildCornerRadius(node: FigmaNode): string | undefined {
  if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    return `${px(tl) ?? "0px"} ${px(tr) ?? "0px"} ${px(br) ?? "0px"} ${px(bl) ?? "0px"}`;
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return px(node.cornerRadius);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Effects -> box-shadow / filter / backdrop-filter
// ---------------------------------------------------------------------------

interface EffectResult {
  boxShadowLayers: string[];
  filter?: string;
  backdropFilter?: string;
}

/**
 * Figma's LAYER_BLUR/BACKGROUND_BLUR `radius` is NOT a CSS `blur()` standard
 * deviation, and mapping it 1:1 renders roughly twice as soft as Figma does.
 *
 * Measured, not guessed: the fidelity harness
 * (`templates/design/scripts/figma-fidelity/run-import.ts`) renders the
 * `fills-effects` corpus frame through this mapper and pixel-diffs it against
 * Figma's own PNG render of the same node. Sweeping a scale factor over the
 * two blurred nodes in that frame and keeping the per-node region diff:
 *
 *   LAYER_BLUR, radius 8   -> mean |delta| 4.73 at 2.4-2.9px, **3.15 at
 *                             3.0-3.8px**, 4.74 at 4.0-4.5px, 5.58 at 5.0px
 *   BACKGROUND_BLUR, r 12  -> mean |delta| 2.19 at 4.5px, 2.15 at 4.8-5.3px,
 *                             **2.14 at 5.4-5.8px**, 2.21 at 6.0px
 *
 * Both minima sit at radius x ~0.45 (8 -> 3.4px, 12 -> 5.5px). Chromium
 * quantises blur into integer box-blur passes, so the minima are plateaus
 * rather than points; 0.45 is the centre of the band both radii agree on.
 * Still recorded as `approximated`: this is a two-radius empirical fit against
 * one renderer, not a published Figma constant.
 */
const FIGMA_BLUR_RADIUS_TO_CSS_BLUR = 0.45;

function buildEffects(
  node: FigmaNode,
  isTextNode: boolean,
  tracker: FidelityTracker,
): EffectResult {
  const effects = (node.effects ?? []).filter(
    (effect) => effect.visible !== false,
  );
  const boxShadowLayers: string[] = [];
  let filter: string | undefined;
  let backdropFilter: string | undefined;

  for (const effect of effects) {
    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      const color = colorToCss(effect.color, 1) ?? "rgba(0, 0, 0, 1)";
      const x = px(effect.offset?.x ?? 0) ?? "0px";
      const y = px(effect.offset?.y ?? 0) ?? "0px";
      const blur = px(effect.radius ?? 0) ?? "0px";
      const spread =
        !isTextNode && typeof effect.spread === "number"
          ? ` ${px(effect.spread)}`
          : "";
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      boxShadowLayers.push(`${inset}${x} ${y} ${blur}${spread} ${color}`);
      tracker.record(
        node,
        "exact",
        `${effect.type} rendered as ${isTextNode ? "text-shadow" : "box-shadow"}.`,
      );
    } else if (effect.type === "LAYER_BLUR") {
      const radius =
        px((effect.radius ?? 0) * FIGMA_BLUR_RADIUS_TO_CSS_BLUR) ?? "0px";
      filter = filter ? `${filter} blur(${radius})` : `blur(${radius})`;
      tracker.record(
        node,
        "approximated",
        `LAYER_BLUR mapped to CSS filter: blur() at ${FIGMA_BLUR_RADIUS_TO_CSS_BLUR}x the Figma radius (fitted against Figma's own renders; see FIGMA_BLUR_RADIUS_TO_CSS_BLUR).`,
      );
    } else if (effect.type === "BACKGROUND_BLUR") {
      const radius =
        px((effect.radius ?? 0) * FIGMA_BLUR_RADIUS_TO_CSS_BLUR) ?? "0px";
      backdropFilter = backdropFilter
        ? `${backdropFilter} blur(${radius})`
        : `blur(${radius})`;
      tracker.record(
        node,
        "approximated",
        `BACKGROUND_BLUR mapped to CSS backdrop-filter: blur() at ${FIGMA_BLUR_RADIUS_TO_CSS_BLUR}x the Figma radius (same fit as LAYER_BLUR).`,
      );
    }
  }

  return { boxShadowLayers, filter, backdropFilter };
}

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

function buildBlendMode(
  node: FigmaNode,
  tracker: FidelityTracker,
): string | undefined {
  const mode = node.blendMode;
  if (!mode) return undefined;
  const result = cssBlendMode(mode);
  if (!result) return undefined;
  if (result.verdict === "approximated") {
    tracker.record(
      node,
      "approximated",
      `Figma blend mode "${mode}" has no CSS equivalent; approximated as mix-blend-mode: ${result.cssMode}.`,
    );
  }
  return result.cssMode;
}

// ---------------------------------------------------------------------------
// Text styling
// ---------------------------------------------------------------------------

function resolveLineHeight(style: FigmaTypeStyle): string | undefined {
  if (
    typeof style.lineHeightPx === "number" &&
    style.lineHeightUnit !== "FONT_SIZE_%"
  ) {
    return px(style.lineHeightPx);
  }
  if (
    typeof style.lineHeightPercentFontSize === "number" &&
    typeof style.fontSize === "number"
  ) {
    // lineHeightPercentFontSize is literally "percent of the font's nominal
    // size" -- resolve to an exact px value rather than a unitless ratio so
    // the rendered line box matches Figma regardless of font metrics.
    return px(style.fontSize * (style.lineHeightPercentFontSize / 100));
  }
  if (typeof style.lineHeightPx === "number") {
    return px(style.lineHeightPx);
  }
  return undefined;
}

function textTransformCss(
  textCase: FigmaTypeStyle["textCase"],
): string | undefined {
  switch (textCase) {
    case "UPPER":
      return "uppercase";
    case "LOWER":
      return "lowercase";
    case "TITLE":
      return "capitalize";
    default:
      return undefined;
  }
}

function textDecorationCss(
  decoration: FigmaTypeStyle["textDecoration"],
): string | undefined {
  switch (decoration) {
    case "UNDERLINE":
      return "underline";
    case "STRIKETHROUGH":
      return "line-through";
    default:
      return undefined;
  }
}

function textAlignCss(
  align: FigmaTypeStyle["textAlignHorizontal"],
): string | undefined {
  switch (align) {
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "JUSTIFIED":
      return "justify";
    case "LEFT":
      return "left";
    default:
      return undefined;
  }
}

function verticalAlignJustifyContent(
  align: FigmaTypeStyle["textAlignVertical"],
): string {
  switch (align) {
    case "CENTER":
      return "center";
    case "BOTTOM":
      return "flex-end";
    default:
      return "flex-start";
  }
}

// ---------------------------------------------------------------------------
// Auto-layout
// ---------------------------------------------------------------------------

function primaryAxisJustify(align: FigmaNode["primaryAxisAlignItems"]): string {
  switch (align) {
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return "flex-start";
  }
}

function counterAxisAlign(align: FigmaNode["counterAxisAlignItems"]): string {
  switch (align) {
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "BASELINE":
      return "baseline";
    default:
      return "flex-start";
  }
}

function buildAutoLayoutStyles(
  node: FigmaNode,
): Record<string, string | undefined> {
  if (
    !node.layoutMode ||
    node.layoutMode === "NONE" ||
    node.layoutMode === "GRID"
  ) {
    return {};
  }
  const isHorizontal = node.layoutMode === "HORIZONTAL";
  const styles: Record<string, string | undefined> = {
    display: "flex",
    "flex-direction": isHorizontal ? "row" : "column",
    "justify-content": primaryAxisJustify(node.primaryAxisAlignItems),
    "align-items": counterAxisAlign(node.counterAxisAlignItems),
  };
  if (node.layoutWrap === "WRAP") styles["flex-wrap"] = "wrap";
  // Figma allows a NEGATIVE itemSpacing, which overlaps auto-layout children.
  // CSS `gap` rejects a negative length outright, so emitting one drops the
  // whole declaration and silently falls back to 0 — Positivus' contact block
  // spaces its children by -367px, and losing that overflowed the row and made
  // flex shrink both children (1240px -> 825px, 691px -> 415px), throwing the
  // illustration out of its card. The overlap is reproduced with a negative
  // margin on every child after the first instead; see `buildChildSizingStyles`.
  // Figma IGNORES itemSpacing when the primary axis is SPACE_BETWEEN — the
  // field is disabled in the UI and the spacing is derived from the free space
  // — but it still reports whatever was last set. CSS treats `gap` as a
  // MINIMUM that space-between distributes on top of, so emitting both spaced
  // Positivus' logo row by the stale 206px instead of its real 96px and pushed
  // the last logo 550px out of the frame.
  const primaryDistributes = node.primaryAxisAlignItems === "SPACE_BETWEEN";
  if (
    typeof node.itemSpacing === "number" &&
    node.itemSpacing > 0 &&
    !primaryDistributes
  ) {
    styles[isHorizontal ? "column-gap" : "row-gap"] = px(node.itemSpacing);
  }
  if (
    typeof node.counterAxisSpacing === "number" &&
    node.counterAxisSpacing > 0
  ) {
    styles[isHorizontal ? "row-gap" : "column-gap"] = px(
      node.counterAxisSpacing,
    );
  }
  const padTop = node.paddingTop ?? 0;
  const padRight = node.paddingRight ?? 0;
  const padBottom = node.paddingBottom ?? 0;
  const padLeft = node.paddingLeft ?? 0;
  if (padTop || padRight || padBottom || padLeft) {
    styles.padding = `${px(padTop)} ${px(padRight)} ${px(padBottom)} ${px(padLeft)}`;
  }
  return styles;
}

/**
 * "FILL" sizing must map to different CSS depending on which axis is the
 * flex *main* axis for this node's parent: main-axis FILL grows via
 * `flex-grow`/`flex-basis` (row parent -> horizontal FILL, column parent ->
 * vertical FILL); cross-axis FILL stretches via `align-self: stretch` (row
 * parent -> vertical FILL, column parent -> horizontal FILL). Passing only a
 * `parentHasAutoLayout` boolean (as this used to) loses the row/column
 * direction and always mapped horizontal-FILL to flex-grow — correct for row
 * parents but wrong for column parents, where a FILL-width text/rect child
 * got `width: auto` with no stretch and overflowed to its content width.
 */
/**
 * Does this node have anything for a HUG axis to hug?
 *
 * Figma keeps an empty auto-layout frame at the size it resolved rather than
 * collapsing it, so HUG on a childless frame still reports real dimensions —
 * a 685x456 image placeholder on the Whitepace hero is one. Mapping that to
 * `width: auto` collapses it to nothing in CSS, and because its sibling was a
 * FILL child, the sibling then took the whole row and the heading stopped
 * wrapping. Two visible defects, one dropped box.
 */
/**
 * Would CSS compute this HUG differently from Figma?
 *
 * A cross-axis FILL child does not feed Figma's hug: Figma sizes the container
 * from its other children and then stretches the FILL child to that. CSS has
 * no such rule — `align-self: stretch` with `width: auto` still feeds the
 * child's max-content into the container's shrink-to-fit width. A Positivus
 * team card holds a FILL row with 76px of right padding, so the column hugged
 * 393px where Figma hugs 317 and every sibling moved with it. Figma has
 * already resolved the real size, so use it rather than asking CSS to derive
 * a rule it does not have.
 */
function hugIsCircularInCss(
  node: FigmaNode,
  axisIsHorizontal: boolean,
): boolean {
  if (!node.layoutMode || node.layoutMode === "NONE") return false;
  const crossIsHorizontal = node.layoutMode === "VERTICAL";
  if (crossIsHorizontal !== axisIsHorizontal) return false;
  return (node.children ?? []).some(
    (child) =>
      (crossIsHorizontal
        ? child.layoutSizingHorizontal
        : child.layoutSizingVertical) === "FILL",
  );
}

function hasContentToHug(node: FigmaNode): boolean {
  return (node.children?.length ?? 0) > 0 || node.type === "TEXT";
}

function buildChildSizingStyles(
  node: FigmaNode,
  parentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL",
  parentItemSpacing = 0,
  isFirstChild = true,
  /**
   * Whether the parent HUGS its own main axis. A main-axis FILL child has
   * nothing to grow into then, and Figma falls back to the child's own size —
   * but `flex-grow:1; flex-basis:0%` in an auto-height column collapses the
   * child to ZERO. A 343x240 photo vanished that way, and because the column
   * hugs, everything below it moved up by 240px.
   */
  parentHugsMainAxis = false,
): Record<string, string | undefined> {
  if (parentLayoutMode === "NONE") return {};
  const parentIsHorizontal = parentLayoutMode === "HORIZONTAL";
  const styles: Record<string, string | undefined> = {};
  // Figma never shrinks an auto-layout child below its own size: a FIXED or
  // HUG child keeps that size and the parent overflows. A CSS flex item
  // shrinks by default, so an overflowing row silently redistributed the
  // deficit across children and every one of them came out the wrong width.
  // Only FILL is elastic, and it sets its own flex properties below.
  const mainAxisSizing = parentIsHorizontal
    ? node.layoutSizingHorizontal
    : node.layoutSizingVertical;
  if (mainAxisSizing !== "FILL") styles["flex-shrink"] = "0";
  // Reproduce a negative itemSpacing as an overlap, since `gap` cannot.
  //
  // Figma CLAMPS that overlap to the following child's own size — a child
  // never slides further back than its own extent. Positivus' CTA row asks for
  // -715 against a 494px illustration and Figma draws it at -494; its team
  // cards ask for -67 against a 34px social icon and Figma draws -34. Taking
  // the stated value literally dragged both across their neighbours. A row
  // whose overlap already fits (the contact block's -367 against a 692px
  // illustration) is untouched, which is how the clamp was confirmed rather
  // than fitted.
  if (parentItemSpacing < 0 && !isFirstChild) {
    const ownMainAxis = parentIsHorizontal
      ? (node.absoluteBoundingBox?.width ?? 0)
      : (node.absoluteBoundingBox?.height ?? 0);
    styles[parentIsHorizontal ? "margin-left" : "margin-top"] = px(
      Math.max(parentItemSpacing, -ownMainAxis),
    );
  }
  if (node.layoutSizingHorizontal === "FILL") {
    if (parentIsHorizontal) {
      if (parentHugsMainAxis) {
        // Nothing to grow into; keep the size Figma resolved.
        styles.width = px(node.absoluteBoundingBox?.width ?? 0);
        styles["flex-shrink"] = "0";
      } else {
        styles["flex-grow"] = "1";
        styles["flex-basis"] = "0%";
        styles.width = "auto";
        // A flex item will not shrink below its content unless told to:
        // `min-width` defaults to `auto`. Figma's FILL just takes the parent's
        // width and lets the content overflow, so without this a card whose
        // content plus padding exceeds its column pushed itself 76px wider
        // than the column and dragged its siblings along.
        if (node.minWidth === undefined) styles["min-width"] = "0";
      }
    } else {
      styles["align-self"] = "stretch";
      styles.width = "auto";
    }
  } else if (node.layoutSizingHorizontal === "HUG") {
    styles.width =
      hasContentToHug(node) && !hugIsCircularInCss(node, true)
        ? "auto"
        : px(node.absoluteBoundingBox?.width ?? 0);
  }
  if (node.layoutSizingVertical === "FILL") {
    if (parentIsHorizontal) {
      styles["align-self"] = "stretch";
      styles.height = "auto";
    } else if (parentHugsMainAxis) {
      // Nothing to grow into; keep the size Figma resolved.
      styles.height = px(node.absoluteBoundingBox?.height ?? 0);
      styles["flex-shrink"] = "0";
    } else {
      styles["flex-grow"] = "1";
      styles["flex-basis"] = "0%";
      styles.height = "auto";
      // See the horizontal case: `min-height: auto` would keep the item at its
      // content height where Figma's FILL lets the content overflow.
      if (node.minHeight === undefined) styles["min-height"] = "0";
    }
  } else if (node.layoutSizingVertical === "HUG") {
    styles.height =
      hasContentToHug(node) && !hugIsCircularInCss(node, false)
        ? "auto"
        : px(node.absoluteBoundingBox?.height ?? 0);
  }
  return styles;
}

// ---------------------------------------------------------------------------
// Vector geometry -> inline <svg>
// ---------------------------------------------------------------------------

/**
 * Node types whose shape is only knowable from `fillGeometry`/`strokeGeometry`.
 * RECTANGLE and full ELLIPSE are deliberately absent: a div with
 * `border-radius` already reproduces them exactly and keeps auto-layout,
 * children, and CSS effects working, which an `<svg>` wrapper would not.
 */
const VECTOR_GEOMETRY_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON",
  "LINE",
]);

/** Paint types an SVG `fill` attribute can reproduce exactly-or-close. */
const SVG_PAINT_TYPES = new Set([
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
]);

/** A full-circle ELLIPSE keeps the cheaper `border-radius: 50%` div path. */
function isFullCircleArc(node: FigmaNode): boolean {
  if (!node.arcData) return true;
  const start = node.arcData.startingAngle ?? 0;
  const end = node.arcData.endingAngle ?? Math.PI * 2;
  return (
    Math.abs(Math.abs(end - start) - Math.PI * 2) < 1e-4 &&
    Math.abs(node.arcData.innerRadius ?? 0) < 1e-4
  );
}

function geometryPaths(node: FigmaNode): FigmaVectorPath[] {
  return [...(node.fillGeometry ?? []), ...(node.strokeGeometry ?? [])].filter(
    (entry) => Boolean(entry.path?.trim()),
  );
}

/**
 * True when this node carries real vector geometry (from
 * `geometry=paths`) that this mapper can paint as an inline `<svg>` instead
 * of a rendered PNG. IMAGE/VIDEO/EMOJI and conic/diamond gradient paints stay
 * on the raster path: SVG has no conic gradient, and an image-filled vector
 * needs a `<pattern>` whose crop/scale semantics are not the same as
 * `background-size`, so guessing one would be a structural approximation this
 * module does not make.
 */
function rendersVectorGeometry(
  node: FigmaNode,
  options: MapFigmaNodeOptions,
): boolean {
  if (options.forceImageFallbackNodeIds?.has(node.id)) return false;
  const isArcEllipse = node.type === "ELLIPSE" && !isFullCircleArc(node);
  if (!VECTOR_GEOMETRY_TYPES.has(node.type) && !isArcEllipse) return false;
  const box = node.absoluteBoundingBox;
  // A zero-extent box gives an unusable `viewBox` (nothing renders); those
  // nodes keep the PNG fallback, which is sized from absoluteRenderBounds.
  if (!box || box.width <= 0 || box.height <= 0) return false;
  if (geometryPaths(node).length === 0) return false;
  return [...(node.fills ?? []), ...(node.strokes ?? [])]
    .filter((paint) => paint.visible !== false)
    .every(
      (paint) =>
        SVG_PAINT_TYPES.has(paint.type) &&
        (!paint.blendMode ||
          paint.blendMode === "NORMAL" ||
          paint.blendMode === "PASS_THROUGH"),
    );
}

function svgId(nodeId: string, suffix: string): string {
  return `fg-${nodeId.replace(/[^A-Za-z0-9_-]/g, "-")}-${suffix}`;
}

function svgGradientStops(paint: FigmaPaint): string {
  return (paint.gradientStops ?? [])
    .map((stop) => {
      const color = stop.color ?? {};
      // guard:allow-raw-color — SVG paint serializer: emits literal color values into the exported document, not app UI
      const rgb = `rgb(${Math.round((color.r ?? 0) * 255)}, ${Math.round((color.g ?? 0) * 255)}, ${Math.round((color.b ?? 0) * 255)})`;
      const alpha = round((color.a ?? 1) * (paint.opacity ?? 1), 4);
      return `<stop offset="${round(stop.position ?? 0, 4)}" stop-color="${rgb}" stop-opacity="${alpha}" />`;
    })
    .join("");
}

/**
 * Resolve one paint to an SVG `fill` value, pushing any `<defs>` it needs.
 * Unlike the CSS path, Figma's `gradientHandlePositions` need no angle
 * derivation or stop remapping here: they are already normalized to the
 * node's box, which is exactly SVG `objectBoundingBox` space.
 */
function paintToSvgFill(
  paint: FigmaPaint,
  node: FigmaNode,
  box: { width: number; height: number },
  defsKey: string,
  defs: string[],
  tracker: FidelityTracker,
): string | null {
  if (paint.type === "SOLID") {
    return colorToCss(paint.color, paint.opacity ?? 1);
  }
  const handles = resolveGradientHandles(paint.gradientHandlePositions);
  if (!handles) {
    tracker.record(
      node,
      "approximated",
      `Vector ${paint.type} fill had no gradientHandlePositions; layer omitted.`,
    );
    return null;
  }
  const id = svgId(node.id, defsKey);
  const stops = svgGradientStops(paint);
  if (paint.type === "GRADIENT_LINEAR") {
    defs.push(
      `<linearGradient id="${id}" x1="${round(handles.start.x, 4)}" y1="${round(handles.start.y, 4)}" x2="${round(handles.end.x, 4)}" y2="${round(handles.end.y, 4)}">${stops}</linearGradient>`,
    );
    tracker.record(
      node,
      "exact",
      "Vector linear gradient mapped to an SVG <linearGradient> using gradientHandlePositions directly.",
    );
    return `url(#${id})`;
  }
  const radiusX = vectorLength(handles.start, handles.end, box);
  const radiusY = vectorLength(handles.start, handles.width, box);
  if (radiusX <= 0 || radiusY <= 0) {
    tracker.record(
      node,
      "approximated",
      "Vector radial gradient collapsed to zero radius; layer omitted.",
    );
    return null;
  }
  // A unit circle transformed into the ellipse Figma's two radius handles
  // describe -- the SVG equivalent of the CSS `radial-gradient(ellipse ...)`
  // mapping used for non-vector nodes.
  defs.push(
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${round(handles.start.x * box.width, 2)} ${round(handles.start.y * box.height, 2)}) scale(${round(radiusX, 2)} ${round(radiusY, 2)})">${stops}</radialGradient>`,
  );
  tracker.record(
    node,
    "approximated",
    "Vector radial gradient rendered as an axis-aligned ellipse sized from gradientHandlePositions; rotated/skewed radial gradients are not expressible without a full gradient transform.",
  );
  return `url(#${id})`;
}

/**
 * Paint a node's flattened vector geometry as an inline `<svg>` sized to the
 * node's own box. Returns null when nothing could be painted, so the caller
 * can keep the node's failure visible instead of emitting an empty element.
 */
function buildVectorSvg(
  node: FigmaNode,
  box: { width: number; height: number },
  tracker: FidelityTracker,
): string | null {
  const defs: string[] = [];
  const paths: string[] = [];

  const emit = (
    geometry: FigmaVectorPath[] | undefined,
    paints: FigmaPaint[] | undefined,
    kind: "fill" | "stroke",
  ) => {
    const visible = (paints ?? []).filter((paint) => paint.visible !== false);
    geometry?.forEach((entry, geometryIndex) => {
      const d = entry.path?.trim();
      if (!d) return;
      const fillRule = entry.windingRule === "EVENODD" ? "evenodd" : "nonzero";
      visible.forEach((paint, paintIndex) => {
        const fill = paintToSvgFill(
          paint,
          node,
          box,
          `${kind}-${geometryIndex}-${paintIndex}`,
          defs,
          tracker,
        );
        if (!fill) return;
        paths.push(
          `<path d="${escapeAttr(d)}" fill="${escapeAttr(fill)}" fill-rule="${fillRule}" />`,
        );
      });
    });
  };

  emit(node.fillGeometry, node.fills, "fill");
  // `strokeGeometry` is the stroke already outlined into a region, so it is
  // painted with `fill` (and the node's stroke paints), never re-stroked.
  emit(node.strokeGeometry, node.strokes, "stroke");

  if (paths.length === 0) return null;
  const defsMarkup = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
  // `overflow: visible` because an outlined stroke legitimately extends past
  // the node's geometric bounding box.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${round(box.width, 2)} ${round(box.height, 2)}" fill="none" style="overflow: visible; display: block">${defsMarkup}${paths.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// Node type classification
// ---------------------------------------------------------------------------

function needsImageFallback(
  node: FigmaNode,
  options: MapFigmaNodeOptions,
): boolean {
  if (options.forceImageFallbackNodeIds?.has(node.id)) return true;
  // A Figma mask affects its following siblings, not just the mask node. CSS
  // cannot reproduce that sibling-range operation on an arbitrary DOM tree,
  // so render the smallest containing subtree rather than importing a visibly
  // wrong unmasked composition. A mask imported as the root is also rendered.
  if (node.isMask || node.children?.some((child) => child.isMask)) return true;
  if (
    (node.effects ?? []).some(
      (effect) =>
        effect.visible !== false &&
        effect.blendMode &&
        effect.blendMode !== "NORMAL" &&
        effect.blendMode !== "PASS_THROUGH",
    )
  ) {
    return true;
  }
  // Real path geometry beats a rendered PNG: it stays editable, scales, and
  // is exact. Only reachable when the caller requested `geometry=paths`.
  if (rendersVectorGeometry(node, options)) return false;
  if (UNSUPPORTED_STRUCTURAL_TYPES.has(node.type)) return true;
  // A CSS div with an outline is not a Figma line, and partial/ring ellipses
  // need real path geometry — without it, both stay rendered PNGs.
  if (node.type === "LINE") return true;
  if (node.type === "ELLIPSE" && !isFullCircleArc(node)) return true;
  const visibleStrokes = (node.strokes ?? []).filter(
    (stroke) => stroke.visible !== false,
  );
  if (
    visibleStrokes.length > 1 ||
    visibleStrokes.some((stroke) => stroke.type !== "SOLID") ||
    (node.strokeDashes?.length ?? 0) > 0
  ) {
    return true;
  }
  const visibleFills = (node.fills ?? []).filter(
    (fill) => fill.visible !== false,
  );
  if (
    visibleFills.some(
      (fill) =>
        fill.type === "VIDEO" ||
        fill.type === "EMOJI" ||
        (fill.blendMode &&
          fill.blendMode !== "NORMAL" &&
          fill.blendMode !== "PASS_THROUGH") ||
        (fill.type === "IMAGE" &&
          ((fill.imageTransform &&
            (Math.abs(fill.imageTransform[0][1]) >= 1e-6 ||
              Math.abs(fill.imageTransform[1][0]) >= 1e-6)) ||
            Object.values(fill.filters ?? {}).some(
              (value) => typeof value === "number" && Math.abs(value) > 1e-6,
            ))),
    ) ||
    (node.type === "TEXT" && visibleFills.some((fill) => fill.type !== "SOLID"))
  ) {
    return true;
  }
  if (node.type === "TEXT") {
    const styles = [
      node.style,
      ...Object.values(node.styleOverrideTable ?? {}),
    ].filter((style): style is FigmaTypeStyle => Boolean(style));
    // `paragraphSpacing` is the gap BETWEEN paragraphs and `listSpacing` the gap
    // between list items — both are no-ops on a single-paragraph, non-list text
    // node. Design systems set them on every text style regardless, so treating
    // their mere presence as unsupported rasterized ordinary labels: on one real
    // community landing page it turned 116 of 146 text nodes into PNGs, one of
    // them the single word "Home". Only escalate when the property can actually
    // affect this node's rendering.
    const paragraphCount = (node.characters ?? "").split("\n").length;
    const hasList = node.lineTypes?.some((type) => type !== "NONE") ?? false;
    const hasAdvancedTypography = styles.some(
      (style) =>
        (paragraphCount > 1 && Math.abs(style.paragraphSpacing ?? 0) > 1e-6) ||
        Math.abs(style.paragraphIndent ?? 0) > 1e-6 ||
        (hasList && Math.abs(style.listSpacing ?? 0) > 1e-6) ||
        style.hangingPunctuation === true ||
        (hasList && style.hangingList === true) ||
        style.hyperlink !== undefined ||
        Object.values(style.opentypeFlags ?? {}).some((value) => value !== 0),
    );
    if (
      hasAdvancedTypography ||
      // Figma's REST API always returns one `lineTypes` entry per line —
      // ordinary non-list text comes back as `["NONE", "NONE", ...]`, not an
      // empty array. Checking `.length > 0` alone treats every multi-line
      // text node in existence as an unsupported list and routes it to an
      // image fallback; only a line whose type is actually "ORDERED" or
      // "UNORDERED" means the text uses real list formatting.
      (node.lineTypes?.some((type) => type !== "NONE") ?? false) ||
      (node.lineIndentations?.some((value) => value !== 0) ?? false)
    ) {
      return true;
    }
  }
  if (
    !SUPPORTED_CONTAINER_TYPES.has(node.type) &&
    node.type !== "RECTANGLE" &&
    node.type !== "ELLIPSE" &&
    node.type !== "TEXT"
  ) {
    return true;
  }
  return false;
}

/** Fail clearly before recursive rendering can overflow or lock the worker. */
export function assertFigmaNodeTreeComplexity(node: FigmaNode): void {
  const stack: Array<{ node: FigmaNode; depth: number }> = [{ node, depth: 1 }];
  const ancestors = new WeakSet<object>();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    count += 1;
    if (count > MAX_FIGMA_NODE_COUNT) {
      throw new Error(
        `Figma node tree is too large (max ${MAX_FIGMA_NODE_COUNT.toLocaleString("en-US")} nodes). Import a smaller frame or selection.`,
      );
    }
    if (current.depth > MAX_FIGMA_NODE_DEPTH) {
      throw new Error(
        `Figma node tree is nested too deeply (max ${MAX_FIGMA_NODE_DEPTH} levels). Import a smaller frame or selection.`,
      );
    }
    if (ancestors.has(current.node)) {
      throw new Error("Figma node tree contains a cyclic child reference.");
    }
    ancestors.add(current.node);
    for (const child of current.node.children ?? []) {
      stack.push({ node: child, depth: current.depth + 1 });
    }
  }
}

/**
 * Walk a node tree and return the ids of every subtree that will render as a
 * PNG image fallback (vector networks, boolean ops, and any node type this
 * mapper does not model structurally). Call this before fetching node data
 * so the caller can request rendered images for exactly these ids via
 * `GET /v1/images/:fileKey?ids=...&scale=2`.
 */
export function collectFallbackNodeIds(
  node: FigmaNode,
  options: MapFigmaNodeOptions = {},
): string[] {
  assertFigmaNodeTreeComplexity(node);
  const ids: string[] = [];
  const visit = (current: FigmaNode) => {
    if (current.visible === false || current.opacity === 0) return;
    if (needsImageFallback(current, options)) {
      ids.push(current.id);
      return; // Don't recurse into a subtree that's rendered as one image.
    }
    // A BOOLEAN_OPERATION's own geometry is already the flattened result, so
    // its operand children are never rendered and need no images.
    if (rendersVectorGeometry(current, options)) return;
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return ids;
}

/**
 * Walk a node tree and return every distinct `imageRef` used by IMAGE fills
 * (on fills or strokes) so the caller can resolve them to URLs via
 * `GET /v1/files/:fileKey/images` before mapping.
 */
export function collectImageFillRefs(
  node: FigmaNode,
  options: MapFigmaNodeOptions = {},
): string[] {
  assertFigmaNodeTreeComplexity(node);
  const refs = new Set<string>();
  const visitPaints = (paints: FigmaPaint[] | undefined) => {
    for (const paint of paints ?? []) {
      if (paint.type === "IMAGE" && paint.imageRef) refs.add(paint.imageRef);
    }
  };
  const visit = (current: FigmaNode) => {
    if (current.visible === false || current.opacity === 0) return;
    if (needsImageFallback(current, options)) return;
    if (rendersVectorGeometry(current, options)) return;
    visitPaints(current.fills);
    visitPaints(current.strokes);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return [...refs];
}

export interface FigmaFontUsage {
  family: string;
  weight: number;
  italic: boolean;
}

function recordFontUsage(
  style: FigmaTypeStyle | undefined,
  usage: Map<string, FigmaFontUsage>,
): void {
  if (!style?.fontFamily) return;
  const weight = typeof style.fontWeight === "number" ? style.fontWeight : 400;
  const italic = Boolean(style.italic);
  const key = `${style.fontFamily}|${weight}|${italic ? 1 : 0}`;
  if (!usage.has(key))
    usage.set(key, { family: style.fontFamily, weight, italic });
}

/**
 * Walk a node tree and return every distinct (font family, weight, italic)
 * combination used by TEXT nodes -- including per-run character style
 * overrides -- so the caller can request the actual web font (e.g. from
 * Google Fonts) before the imported HTML is saved. Without this, an imported
 * screen's CSS correctly names the intended font-family, but the browser has
 * no way to load it and silently falls back to a generic sans-serif with
 * different glyph advance widths -- individually invisible per character but
 * compounding into a growing horizontal drift across any wrapped or
 * multi-word line, worst on text-dense imports.
 */
export function collectFontUsage(node: FigmaNode): FigmaFontUsage[] {
  assertFigmaNodeTreeComplexity(node);
  const usage = new Map<string, FigmaFontUsage>();
  const visit = (current: FigmaNode) => {
    if (current.visible === false || current.opacity === 0) return;
    if (current.type === "TEXT") {
      recordFontUsage(current.style, usage);
      for (const style of Object.values(current.styleOverrideTable ?? {})) {
        recordFontUsage(style, usage);
      }
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return [...usage.values()];
}

function textOverrideCss(
  style: FigmaTypeStyle | undefined,
): Record<string, string | undefined> {
  const solidFill = [...(style?.fills ?? [])]
    .reverse()
    .find((fill) => fill.visible !== false && fill.type === "SOLID");
  return {
    "font-family": style?.fontFamily
      ? `"${style.fontFamily.replace(/"/g, "")}", sans-serif`
      : undefined,
    "font-size": px(style?.fontSize),
    "font-weight":
      typeof style?.fontWeight === "number"
        ? String(style.fontWeight)
        : undefined,
    "font-style": style?.italic ? "italic" : undefined,
    "line-height": style ? resolveLineHeight(style) : undefined,
    "letter-spacing":
      typeof style?.letterSpacing === "number"
        ? px(style.letterSpacing)
        : undefined,
    "text-transform": textTransformCss(style?.textCase),
    "text-decoration": textDecorationCss(style?.textDecoration),
    color: solidFill
      ? (colorToCss(solidFill.color, solidFill.opacity ?? 1) ?? undefined)
      : undefined,
  };
}

/** Render contiguous Figma character-style override runs as inline spans. */
function buildMixedTextHtml(
  node: FigmaNode,
  characters: string,
  tracker: FidelityTracker,
): string {
  const overrideIds = node.characterStyleOverrides ?? [];
  const table = node.styleOverrideTable ?? {};
  if (
    characters.length === 0 ||
    !overrideIds.some((id) => id !== 0 && table[String(id)])
  ) {
    return escapeHtml(characters);
  }

  const runs: Array<{ id: number; text: string }> = [];
  for (let index = 0; index < characters.length; index += 1) {
    const id = overrideIds[index] ?? 0;
    const previous = runs[runs.length - 1];
    if (previous?.id === id) previous.text += characters[index] ?? "";
    else runs.push({ id, text: characters[index] ?? "" });
  }

  tracker.record(
    node,
    "exact",
    "Mixed character style overrides were preserved as inline text runs.",
  );
  return runs
    .map((run) => {
      if (run.id === 0) return escapeHtml(run.text);
      const style = table[String(run.id)];
      if (!style) return escapeHtml(run.text);
      return `<span style="${styleAttr(textOverrideCss(style))}">${escapeHtml(run.text)}</span>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

interface LocalBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * True when the box came from `relativeTransform`/`size` and is already in
   * the parent's own unrotated frame at the node's true pre-rotation size —
   * i.e. the AABB un-rotation heuristic must NOT be applied on top of it.
   */
  exact: boolean;
}

/**
 * A node's box in its PARENT's own (unrotated) coordinate frame, as CSS
 * `left`/`top`/`width`/`height` for an element rotated about its center.
 *
 * `absoluteBoundingBox` is in absolute canvas space and is the AABB of the
 * ALREADY-rotated shape, so subtracting the parent's AABB origin is wrong
 * twice over for any node under a rotated ancestor: the offset is measured in
 * rotated space, and the size is the inflated AABB. (Real case: `shapes` >
 * "Rotated Nested Frame" > "Rotated Child", authored 60x30 at (20,20), came
 * out 65.7x44.5 at (24.5,29.7) and drifted further as the parent's angle grew.)
 *
 * Figma also returns `relativeTransform` — whose translation is the node's
 * local origin expressed in the parent's local frame — and `size`, the true
 * pre-rotation size. Together they are exact, so they are preferred whenever
 * present. The node's center is `M * (size/2)`, and CSS positions the
 * unrotated box around that center because `transform-origin: center` rotates
 * about it. `absoluteBoundingBox` remains the fallback for callers (and
 * fixtures) that carry no transform.
 */
function frameRelativeBox(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
): LocalBox {
  const transform = node.relativeTransform;
  const size = node.size;
  // A LINE is zero-thickness by definition, so requiring BOTH dimensions to be
  // positive pushed every rotated rule onto the absoluteBoundingBox fallback —
  // whose box is the ALREADY-ROTATED one. Rotating that again squared the
  // turn: a 216x0 rule at 54 degrees drew a 216x205 diagonal where Figma draws
  // 126x176. One positive dimension is enough to place the node exactly.
  if (parentBox && transform && size && (size.x > 0 || size.y > 0)) {
    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const centerX =
      transform[0][0] * halfX + transform[0][1] * halfY + transform[0][2];
    const centerY =
      transform[1][0] * halfX + transform[1][1] * halfY + transform[1][2];
    return {
      left: centerX - halfX,
      top: centerY - halfY,
      width: size.x,
      height: size.y,
      exact: true,
    };
  }
  const box = node.absoluteBoundingBox;
  if (!box) return { left: 0, top: 0, width: 0, height: 0, exact: false };
  return {
    left: box.x - (parentBox?.x ?? box.x),
    top: box.y - (parentBox?.y ?? box.y),
    width: box.width,
    height: box.height,
    exact: false,
  };
}

/**
 * Figma's `absoluteBoundingBox` for a rotated node is the axis-aligned
 * bounding box of the ALREADY-ROTATED shape, not the shape's own (pre-
 * rotation) width/height -- e.g. a 120x80 rectangle rotated 15 degrees comes
 * back with an ~136.6x108.3 bounding box. Applying a CSS `rotate()` on TOP
 * of a div already sized to that expanded AABB rotates an oversized box,
 * producing a visibly wrong (too-large, wrong-aspect-ratio) rotated shape.
 * This inverts the AABB formula (`W' = W*|cos| + H*|sin|`,
 * `H' = W*|sin| + H*|cos|`) to recover the true pre-rotation width/height,
 * then re-centers the (smaller) box at the same center point the AABB had --
 * matching this module's existing "rotate about the AABB center" pivot
 * assumption, so the CSS `rotate()` reproduces the original box exactly.
 */
function unrotateBox(
  box: { left: number; top: number; width: number; height: number },
  rotationDeg: number,
): { left: number; top: number; width: number; height: number } {
  const theta = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const det = c * c - s * s;
  // Near +-45/+-135 degrees the AABB<->true-size system is near-singular
  // (many different true sizes produce almost the same AABB); fall back to
  // the AABB dimensions rather than dividing by ~zero and producing a huge
  // or negative "true" size.
  if (Math.abs(det) < 0.05) return box;
  const trueWidth = (c * box.width - s * box.height) / det;
  const trueHeight = (c * box.height - s * box.width) / det;
  if (
    !Number.isFinite(trueWidth) ||
    !Number.isFinite(trueHeight) ||
    trueWidth <= 0 ||
    trueHeight <= 0
  ) {
    return box;
  }
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  return {
    left: centerX - trueWidth / 2,
    top: centerY - trueHeight / 2,
    width: trueWidth,
    height: trueHeight,
  };
}

/**
 * Same as `frameRelativeBox` but sized/positioned from `absoluteRenderBounds`
 * (falling back to `absoluteBoundingBox` when Figma didn't return render
 * bounds). Used only for image-fallback `<img>` geometry -- see the
 * `absoluteRenderBounds` field doc for why the geometric box is wrong there.
 */
function frameRelativeRenderBox(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
): { left: number; top: number; width: number; height: number } {
  const box = node.absoluteRenderBounds ?? node.absoluteBoundingBox;
  if (!box) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: box.x - (parentBox?.x ?? box.x),
    top: box.y - (parentBox?.y ?? box.y),
    width: box.width,
    height: box.height,
  };
}

/**
 * Does this auto-layout frame size itself to its content along its own main
 * axis? Figma reports it as `layoutSizingHorizontal`/`layoutSizingVertical`
 * on current files and as `primaryAxisSizingMode: "AUTO"` on older ones, and
 * both spellings appear in real community files.
 */
function hugsMainAxis(node: FigmaNode): boolean {
  const mainSizing =
    node.layoutMode === "HORIZONTAL"
      ? node.layoutSizingHorizontal
      : node.layoutSizingVertical;
  if (mainSizing) return mainSizing === "HUG";
  return node.primaryAxisSizingMode === "AUTO";
}

function buildNode(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
  parentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL",
  options: MapFigmaNodeOptions,
  tracker: FidelityTracker,
  isRoot: boolean,
  /** The parent's `itemSpacing`; only a negative value reaches the child, as an overlap. */
  parentItemSpacing = 0,
  isFirstChild = true,
  /** Whether the parent hugs its main axis — see `buildChildSizingStyles`. */
  parentHugsMainAxis = false,
): string {
  const parentHasAutoLayout = parentLayoutMode !== "NONE";
  if (node.visible === false || node.opacity === 0) return "";

  let box = frameRelativeBox(node, parentBox);
  // The Figma REST API's file-node-types docs describe `rotation` as
  // "in degrees", but empirically (verified against known authored values
  // via the Plugin API -- e.g. an authored 15deg/20deg rotation comes back
  // as 0.2617993.../0.3490658... here) the REST API actually returns
  // RADIANS. Treating that value as degrees silently shrinks every rotation
  // by a factor of ~57 (pi/180), rendering rotated content as visually
  // unrotated. Convert to degrees before using it anywhere below.
  const rotationDeg =
    typeof node.rotation === "number"
      ? (node.rotation * 180) / Math.PI
      : undefined;
  const rotation =
    rotationDeg !== undefined && Math.abs(rotationDeg) > 0.001
      ? rotationDeg
      : undefined;
  // `rotation` is a decomposition, and it cannot express a mirror: a
  // horizontally flipped node reports rotation = pi, exactly as a 180-degree
  // one does. Rotating by 180 then adds a vertical flip the design does not
  // have — Positivus' CTA illustration is mirrored that way, and every element
  // inside it landed on the wrong side. `relativeTransform`'s 2x2 block is
  // already CSS's own matrix in the same y-down space, so consume it directly
  // whenever the box came from it; this is the exact path the header comment
  // has always named as the follow-up for when a design surfaces the mismatch.
  const linear = box.exact ? node.relativeTransform : undefined;
  const isIdentityLinear =
    linear !== undefined &&
    Math.abs(linear[0][0] - 1) < 1e-6 &&
    Math.abs(linear[0][1]) < 1e-6 &&
    Math.abs(linear[1][0]) < 1e-6 &&
    Math.abs(linear[1][1] - 1) < 1e-6;
  const linearTransformCss =
    linear !== undefined && !isIdentityLinear
      ? `matrix(${round(linear[0][0], 6)}, ${round(linear[1][0], 6)}, ` +
        `${round(linear[0][1], 6)}, ${round(linear[1][1], 6)}, 0, 0)`
      : undefined;
  if (rotation !== undefined && !box.exact) {
    // `box` fell back to absoluteBoundingBox, which is the rotated shape's
    // AABB; recover the true pre-rotation width/height/position so
    // fills/effects/strokes below -- and the CSS `rotate()` applied later --
    // operate on the correct box instead of an oversized one. When
    // `frameRelativeBox` had `relativeTransform`/`size` it already returned
    // the true box and this inversion would shrink it a second time.
    box = { ...unrotateBox(box, rotation), exact: false };
  }
  const nameAttr = node.name
    ? ` data-agent-native-layer-name="${escapeAttr(node.name)}"`
    : "";
  const idAttr = ` data-figma-node-id="${escapeAttr(node.id)}"`;
  const typeAttr = ` data-figma-node-type="${escapeAttr(node.type)}"`;
  const semanticAttrs =
    metadataAttr("data-figma-component-id", node.componentId, node, tracker) +
    metadataAttr(
      "data-figma-component-properties",
      node.componentProperties,
      node,
      tracker,
    ) +
    metadataAttr(
      "data-figma-bound-variables",
      node.boundVariables,
      node,
      tracker,
    ) +
    metadataAttr("data-figma-interactions", node.interactions, node, tracker);
  if (node.componentId || node.componentProperties) {
    tracker.record(
      node,
      "approximated",
      "Figma component/instance provenance was preserved as metadata, but the imported HTML is not linked to the original Figma component master.",
    );
  }
  if (node.boundVariables && Object.keys(node.boundVariables).length > 0) {
    tracker.record(
      node,
      "approximated",
      "Figma variable bindings were preserved as metadata; resolved visual values are imported, but bindings are not live Design tokens.",
    );
  }
  if (node.interactions && node.interactions.length > 0) {
    tracker.record(
      node,
      "approximated",
      "Prototype interactions were preserved as inert metadata and do not execute or navigate inside the editor preview.",
    );
  }

  if (needsImageFallback(node, options)) {
    const imageUrl = options.fallbackImageUrls?.[node.id];
    if (!imageUrl) {
      tracker.record(
        node,
        "image-fallback",
        `Node type "${node.type}" requires an image fallback but no rendered URL was provided; nothing was rendered for this node.`,
      );
      return "";
    }
    tracker.record(
      node,
      "image-fallback",
      `Node type "${node.type}" cannot be reproduced structurally (vector network / boolean op / unsupported type); rendered as an exact PNG (scale=2) instead of an approximated structural guess.`,
    );
    const isFlowChild =
      !isRoot && parentHasAutoLayout && node.layoutPositioning !== "ABSOLUTE";
    // Use render bounds (not the geometric box) so a fallback PNG whose
    // stroke/effects overflow the node's own bounding box (e.g. an
    // OUTSIDE-aligned stroke) is placed at its natural size instead of being
    // squished/cropped into the smaller geometric box.
    const renderBox = frameRelativeRenderBox(node, parentBox);
    const styles: Record<string, string | undefined> = {
      position: isRoot || isFlowChild ? "relative" : "absolute",
      left: isRoot || isFlowChild ? undefined : px(renderBox.left),
      top: isRoot || isFlowChild ? undefined : px(renderBox.top),
      width: px(renderBox.width),
      height: px(renderBox.height),
      opacity:
        typeof node.opacity === "number" && node.opacity !== 1
          ? String(round(node.opacity, 4))
          : undefined,
    };
    return `<img${idAttr}${typeAttr}${nameAttr}${semanticAttrs} src="${escapeAttr(imageUrl)}" alt="${escapeAttr(node.name ?? "")}" style="${styleAttr(styles)}" />`;
  }

  const isTextNode = node.type === "TEXT";
  const box2 = { width: box.width, height: box.height };
  // A vector node paints its fills/strokes inside the <svg> (against the real
  // path, not the bounding box), so the wrapper div must not also paint them.
  const isVector = rendersVectorGeometry(node, options);
  const vectorSvg = isVector ? buildVectorSvg(node, box2, tracker) : null;
  const isEllipse = node.type === "ELLIPSE" && !isVector;

  const fills = isVector
    ? {}
    : buildFills(node, node.fills, box2, options, tracker, isTextNode);
  const strokeResult: StrokeResult = isVector
    ? { styles: {} }
    : buildStrokes(node, tracker);
  const effects = buildEffects(node, isTextNode, tracker);
  const cornerRadius = isVector
    ? undefined
    : isEllipse
      ? "50%"
      : buildCornerRadius(node);
  const blendMode = buildBlendMode(node, tracker);

  const boxShadowParts = [...effects.boxShadowLayers];
  if (strokeResult.insetShadow) boxShadowParts.push(strokeResult.insetShadow);

  if (linearTransformCss !== undefined) {
    tracker.record(
      node,
      "exact",
      "Transform taken from relativeTransform's 2x2 block as a CSS matrix(), so rotation, mirroring and skew all survive.",
    );
  } else if (rotation !== undefined) {
    tracker.record(
      node,
      "approximated",
      `Rotation (${round(rotation, 2)}deg) reconstructed by pivoting the unrotated box about the absoluteBoundingBox center; exact only when Figma's internal pivot is also the shape's center.`,
    );
  }

  const autoLayoutStyles = buildAutoLayoutStyles(node);
  const childSizingStyles = buildChildSizingStyles(
    node,
    parentLayoutMode,
    parentItemSpacing,
    isFirstChild,
    parentHugsMainAxis,
  );
  const hasAutoLayout = Boolean(autoLayoutStyles.display);
  // A node is positioned relative to its parent's free canvas (absolute,
  // left/top from absoluteBoundingBox) unless its *parent* is an auto-layout
  // container, in which case it's a normal flex item (relative, no left/top)
  // -- this mirrors Figma's own rule that auto-layout children give up
  // manual x/y in favor of flex flow.
  const isFlexChild =
    !isRoot && parentHasAutoLayout && node.layoutPositioning !== "ABSOLUTE";

  const baseStyles: Record<string, string | undefined> = {
    position: isRoot ? "relative" : isFlexChild ? "relative" : "absolute",
    left: isRoot || isFlexChild ? undefined : px(box.left),
    top: isRoot || isFlexChild ? undefined : px(box.top),
    width: childSizingStyles.width ?? px(box.width),
    height: childSizingStyles.height ?? px(box.height),
    "background-color": fills.backgroundColor,
    "background-image": fills.backgroundImage,
    "background-size": fills.backgroundSize,
    "background-position": fills.backgroundPosition,
    "background-repeat": fills.backgroundRepeat,
    "image-rendering": fills.imageRendering,
    color: fills.color,
    "border-radius": cornerRadius,
    "box-shadow":
      boxShadowParts.length > 0 ? boxShadowParts.join(", ") : undefined,
    filter: effects.filter,
    "backdrop-filter": effects.backdropFilter,
    "-webkit-backdrop-filter": effects.backdropFilter,
    opacity:
      typeof node.opacity === "number" && node.opacity !== 1
        ? String(round(node.opacity, 4))
        : undefined,
    "mix-blend-mode": blendMode,
    overflow: node.clipsContent ? "hidden" : undefined,
    transform:
      linearTransformCss ??
      (rotation !== undefined ? `rotate(${round(rotation, 3)}deg)` : undefined),
    "transform-origin":
      linearTransformCss !== undefined || rotation !== undefined
        ? "center"
        : undefined,
    "min-width": px(node.minWidth ?? undefined),
    "max-width": px(node.maxWidth ?? undefined),
    "min-height": px(node.minHeight ?? undefined),
    "max-height": px(node.maxHeight ?? undefined),
    ...autoLayoutStyles,
    ...strokeResult.styles,
    ...childSizingStyles,
  };

  // A CSS transform does not change an element's LAYOUT size, but Figma lays a
  // rotated auto-layout child out by its rotated footprint. A vertical rule is
  // the common case: Figma stores it as a 186x0 line rotated 90deg, so it
  // occupies no width in the row — ours occupied the full 186px and shoved
  // every later sibling across (Positivus' case-studies row came out 372px too
  // wide, exactly its two dividers). Compensate with margins so the footprint
  // matches, leaving the element's own box and transform untouched: the
  // transform pivots about the centre, which the margins keep in place.
  if (
    isFlexChild &&
    (linearTransformCss !== undefined || rotation !== undefined)
  ) {
    const theta = ((rotation ?? 0) * Math.PI) / 180;
    const m = linear ?? [
      [Math.cos(theta), -Math.sin(theta), 0],
      [Math.sin(theta), Math.cos(theta), 0],
    ];
    const spanX =
      Math.abs(m[0][0]) * box.width + Math.abs(m[0][1]) * box.height;
    const spanY =
      Math.abs(m[1][0]) * box.width + Math.abs(m[1][1]) * box.height;
    const marginX = (spanX - box.width) / 2;
    const marginY = (spanY - box.height) / 2;
    const add = (property: string, value: number) => {
      if (Math.abs(value) < 0.01) return;
      const existing = Number.parseFloat(baseStyles[property] ?? "0") || 0;
      baseStyles[property] = px(existing + value);
    };
    add("margin-left", marginX);
    add("margin-right", marginX);
    add("margin-top", marginY);
    add("margin-bottom", marginY);
  }

  if (isTextNode) {
    const style = node.style ?? {};
    baseStyles["font-family"] = style.fontFamily
      ? `"${style.fontFamily.replace(/"/g, "")}", sans-serif`
      : undefined;
    baseStyles["font-size"] = px(style.fontSize);
    baseStyles["font-weight"] =
      typeof style.fontWeight === "number"
        ? String(style.fontWeight)
        : undefined;
    baseStyles["font-style"] = style.italic ? "italic" : undefined;
    baseStyles["line-height"] = resolveLineHeight(style);
    baseStyles["letter-spacing"] =
      typeof style.letterSpacing === "number" && style.letterSpacing !== 0
        ? px(style.letterSpacing)
        : undefined;
    baseStyles["text-transform"] = textTransformCss(style.textCase);
    baseStyles["text-decoration"] = textDecorationCss(style.textDecoration);
    baseStyles["text-align"] = textAlignCss(style.textAlignHorizontal);
    const spanStyles: Record<string, string | undefined> = {};
    if (style.textAutoResize === "TRUNCATE") {
      baseStyles["white-space"] = "nowrap";
      baseStyles.overflow = "hidden";
      // `text-overflow` ellipsizes the inline content of a *block* container.
      // The text lives in a <span> flex item (the flex column below is how
      // textAlignVertical is reproduced), so putting it only on the wrapper
      // clips the string with no ellipsis -- which reads as a normal, correct
      // truncation and is exactly the kind of near-miss this mapper must not
      // ship. The span is the block that has to carry it.
      spanStyles.display = "block";
      spanStyles.overflow = "hidden";
      spanStyles["text-overflow"] = "ellipsis";
      spanStyles["min-width"] = "0";
    } else {
      // Figma preserves explicit newlines and repeated spaces. Normal HTML
      // whitespace collapsing changes both wrapping and measured geometry.
      baseStyles["white-space"] = "pre-wrap";
    }
    baseStyles.display = "flex";
    baseStyles["flex-direction"] = "column";
    baseStyles["justify-content"] = verticalAlignJustifyContent(
      style.textAlignVertical,
    );
    tracker.record(node, "exact", "Text styling mapped from TypeStyle fields.");

    // Figma stores paragraph breaks as CR, and its `characters` very often ends
    // with one. Figma does NOT render a trailing break as an extra line, but
    // `white-space: pre-wrap` does — every such label came out one line taller
    // and pushed its siblings down with it (67 nodes on the Whitepace page
    // alone, 20px each). Trailing whitespace after the break goes too: Figma
    // renders neither.
    const characters = (node.characters ?? "").replace(/[\r\n][ \t]*$/, "");
    const textHtml = buildMixedTextHtml(node, characters, tracker);
    const spanAttr = styleAttr(spanStyles);
    const spanOpen = spanAttr ? `<span style="${spanAttr}">` : "<span>";
    return `<div${idAttr}${typeAttr}${nameAttr}${semanticAttrs} style="${styleAttr(baseStyles)}">${spanOpen}${textHtml}</span></div>`;
  }

  if (vectorSvg) {
    tracker.record(
      node,
      "exact",
      `Node type "${node.type}" reconstructed from its real fillGeometry/strokeGeometry as inline SVG paths instead of a rendered PNG.`,
    );
  } else if (isVector) {
    // Vector geometry was present but nothing was paintable (no visible fills
    // or strokes). Say so rather than leaving a blank box unexplained.
    tracker.record(
      node,
      "approximated",
      `Node type "${node.type}" has vector geometry but no visible fill or stroke paint; rendered as an empty box.`,
    );
  } else {
    tracker.record(
      node,
      "exact",
      "Position, size, fills, strokes, and effects mapped 1:1.",
    );
  }

  // hasAutoLayout guarantees node.layoutMode is "HORIZONTAL" or "VERTICAL"
  // (buildAutoLayoutStyles returns {} -- no `display` -- for "NONE"/"GRID").
  const childParentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" =
    hasAutoLayout ? (node.layoutMode as "HORIZONTAL" | "VERTICAL") : "NONE";
  // A vector node's geometry is already the flattened result of its operands
  // (BOOLEAN_OPERATION children), so its children are never rendered.
  const childrenHtml = isVector
    ? (vectorSvg ?? "")
    : (node.children ?? [])
        .map((child, index) =>
          buildNode(
            child,
            node.absoluteBoundingBox ?? null,
            childParentLayoutMode,
            options,
            tracker,
            false,
            hasAutoLayout ? (node.itemSpacing ?? 0) : 0,
            index === 0,
            hasAutoLayout && hugsMainAxis(node),
          ),
        )
        .filter(Boolean)
        .join("\n");

  // Fill overlays are part of the node's own paint stack, so they go first --
  // beneath every real child, above the background stack.
  const innerHtml = [fills.overlayHtml, childrenHtml]
    .filter(Boolean)
    .join("\n");

  return `<div${idAttr}${typeAttr}${nameAttr}${semanticAttrs} style="${styleAttr(baseStyles)}">\n${innerHtml}\n</div>`;
}

/**
 * Map a Figma node (and its subtree) to an HTML fragment plus a fidelity
 * report describing which properties were exact, approximated, or rendered
 * as an image fallback.
 */
export function mapFigmaNodeToHtml(
  node: FigmaNode,
  options: MapFigmaNodeOptions = {},
): MapFigmaNodeResult {
  assertFigmaNodeTreeComplexity(node);
  const tracker = new FidelityTracker();
  const html = buildNode(node, null, "NONE", options, tracker, true);
  return { html, fidelity: tracker.build() };
}
