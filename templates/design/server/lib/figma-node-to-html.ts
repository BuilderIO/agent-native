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
 * | Strokes (uniform, align)                     | exact         | CENTER via outline+negative offset, INSIDE via inset box-shadow, OUTSIDE via outline |
 * | Strokes (per-side weights)                   | approximated  | CSS has no per-side outline; falls back to per-side `border` (inside-only) |
 * | Corner radii (uniform + per-corner)          | exact         | |
 * | Effects: drop/inner shadow                   | exact         | |
 * | Effects: layer/background blur               | approximated  | Figma <-> CSS blur radius scale is not publicly specified as 1:1 |
 * | Opacity                                      | exact         | |
 * | Blend modes (CSS-supported)                   | exact         | |
 * | Blend modes (Figma-only: LINEAR_BURN/DODGE/LIGHTER/DARKER) | approximated | mapped to closest CSS equivalent |
 * | clipsContent                                  | exact        | overflow: hidden |
 * | Rotation                                      | approximated | pivots about the bounding-box center (see below) |
 * | Vector networks / boolean ops / unsupported types | image fallback | never approximated structurally |
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
 * about `transform-origin: center` by `-rotation` degrees (Figma's rotation
 * is clockwise-negative relative to CSS's clockwise-positive convention).
 * This is exact when Figma pivots rotation about the shape's center and only
 * approximated if Figma's internal pivot differs (rare in practice; visually
 * indistinguishable in the overwhelming majority of designs). A fully exact
 * alternative would consume `relativeTransform` as a CSS `matrix()` directly,
 * which is a documented follow-up if a specific design surfaces a visible
 * mismatch.
 */

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
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
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

interface GradientGeometry {
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: { x: number; y: number };
}

function resolveGradientGeometry(paint: FigmaPaint): GradientGeometry | null {
  const handles = paint.gradientHandlePositions;
  if (!handles || handles.length < 3) return null;
  return { start: handles[0]!, end: handles[1]!, width: handles[2]! };
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
  const geometry = resolveGradientGeometry(paint);
  if (!geometry) return null;
  const dx = (geometry.end.x - geometry.start.x) * box.width;
  const dy = (geometry.end.y - geometry.start.y) * box.height;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = (angleRad * 180) / Math.PI + 90;
  return ((angleDeg % 360) + 360) % 360;
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

/**
 * CSS `linear-gradient(angle, ...)` always stretches its 0%/100% stops
 * across the box's FULL diagonal extent at that angle (the CSS spec's
 * "gradient line" always spans corner-to-corner) -- it has no way to say
 * "start partway in, end partway in" the way Figma's actual gradient handles
 * can (a designer can drag the start/end handles anywhere, including short
 * of the shape's edges, or past them). Figma's own stop positions are
 * fractions of the literal start-handle-to-end-handle distance, which only
 * happens to coincide with the CSS full-box span when the handles are
 * dragged exactly corner-to-corner -- a common case, but far from the only
 * one, and the divergence gets worse the more the box's aspect ratio departs
 * from square (rotated/skewed handles included, e.g. gradientTransform-authored
 * paints). This projects each Figma stop's real pixel position onto the same
 * angle CSS will use and re-expresses it as a percentage of the CSS line's
 * length, so a partial/offset gradient renders at the same actual pixel
 * positions Figma draws it at instead of silently stretching to fill the box.
 */
function remapLinearStopPosition(
  geometry: GradientGeometry,
  box: { width: number; height: number },
  angleDeg: number,
): (position: number) => number {
  const angleRad = (angleDeg * Math.PI) / 180;
  const ux = Math.sin(angleRad);
  const uy = -Math.cos(angleRad);
  const lineLength = box.width * Math.abs(ux) + box.height * Math.abs(uy);
  if (lineLength < 1e-6) return (position) => position;
  const startPx = {
    x: geometry.start.x * box.width,
    y: geometry.start.y * box.height,
  };
  const endPx = {
    x: geometry.end.x * box.width,
    y: geometry.end.y * box.height,
  };
  const centerX = box.width / 2;
  const centerY = box.height / 2;
  return (position: number) => {
    const pointX = startPx.x + position * (endPx.x - startPx.x);
    const pointY = startPx.y + position * (endPx.y - startPx.y);
    const projected = (pointX - centerX) * ux + (pointY - centerY) * uy;
    return (projected + lineLength / 2) / lineLength;
  };
}

function vectorLength(
  from: { x: number; y: number },
  to: { x: number; y: number },
  box: { width: number; height: number },
): number {
  const dx = (to.x - from.x) * box.width;
  const dy = (to.y - from.y) * box.height;
  return Math.sqrt(dx * dx + dy * dy);
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
      const fromAngle = geometry ? gradientAngleDegrees(paint, box) : 0;
      tracker.record(
        node,
        "approximated",
        "Conic (angular) gradient start angle derived from gradientHandlePositions using the same angle formula as linear gradients; CSS conic-gradient() has no elliptical distortion so non-uniform boxes may render slightly differently than Figma.",
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
  color?: string; // for TEXT nodes, fill paints color the glyphs, not a background
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
  let backgroundColor: string | undefined;

  // Reverse so the topmost Figma fill becomes the first (topmost) CSS layer.
  const ordered = [...visible].reverse();
  for (let index = 0; index < ordered.length; index += 1) {
    const fill = ordered[index]!;
    const isBottommost = index === ordered.length - 1;

    if (fill.type === "SOLID") {
      const color = colorToCss(fill.color, fill.opacity ?? 1);
      if (!color) continue;
      if (isBottommost) {
        // A bottom-most solid always paints beneath every background-image
        // layer, so it can always become plain backgroundColor regardless of
        // how many gradient/image layers are stacked above it.
        backgroundColor = color;
      } else {
        // Solid above other layers: express as a flat gradient so it stacks
        // in the correct z-order alongside gradient/image layers.
        images.push(`linear-gradient(${color}, ${color})`);
        sizes.push("100% 100%");
        positions.push("center");
        repeats.push("no-repeat");
      }
      continue;
    }

    if (fill.type === "IMAGE") {
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
      images.push(`url("${url}")`);
      sizes.push(mode.size);
      positions.push(mode.position);
      repeats.push(mode.repeat);
      continue;
    }

    const cssImage = paintToCssImage(fill, box, tracker, node);
    if (cssImage) {
      images.push(cssImage);
      sizes.push("100% 100%");
      positions.push("center");
      repeats.push("no-repeat");
    }
  }

  const result: BackgroundResult = {};
  if (backgroundColor) result.backgroundColor = backgroundColor;
  if (images.length > 0) {
    result.backgroundImage = images.join(", ");
    result.backgroundSize = sizes.join(", ");
    result.backgroundPosition = positions.join(", ");
    result.backgroundRepeat = repeats.join(", ");
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
      const radius = px(effect.radius ?? 0) ?? "0px";
      filter = filter ? `${filter} blur(${radius})` : `blur(${radius})`;
      tracker.record(
        node,
        "approximated",
        "LAYER_BLUR mapped 1:1 to CSS filter: blur(); Figma's blur radius-to-CSS-stdDeviation scale is not publicly documented, so the rendered softness may differ slightly.",
      );
    } else if (effect.type === "BACKGROUND_BLUR") {
      const radius = px(effect.radius ?? 0) ?? "0px";
      backdropFilter = backdropFilter
        ? `${backdropFilter} blur(${radius})`
        : `blur(${radius})`;
      tracker.record(
        node,
        "approximated",
        "BACKGROUND_BLUR mapped 1:1 to CSS backdrop-filter: blur(); same radius-scale caveat as LAYER_BLUR.",
      );
    }
  }

  return { boxShadowLayers, filter, backdropFilter };
}

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

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

function buildBlendMode(
  node: FigmaNode,
  tracker: FidelityTracker,
): string | undefined {
  const mode = node.blendMode;
  if (!mode || mode === "PASS_THROUGH" || mode === "NORMAL") return undefined;
  const cssMode = mode.toLowerCase().replace(/_/g, "-");
  if (CSS_BLEND_MODES.has(cssMode)) return cssMode;
  const fallback = FIGMA_ONLY_BLEND_MODE_FALLBACK[mode];
  if (fallback) {
    tracker.record(
      node,
      "approximated",
      `Figma blend mode "${mode}" has no CSS equivalent; approximated as mix-blend-mode: ${fallback}.`,
    );
    return fallback;
  }
  return undefined;
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
  if (typeof node.itemSpacing === "number" && node.itemSpacing !== 0) {
    styles[isHorizontal ? "column-gap" : "row-gap"] = px(node.itemSpacing);
  }
  if (
    typeof node.counterAxisSpacing === "number" &&
    node.counterAxisSpacing !== 0
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
function buildChildSizingStyles(
  node: FigmaNode,
  parentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL",
): Record<string, string | undefined> {
  if (parentLayoutMode === "NONE") return {};
  const parentIsHorizontal = parentLayoutMode === "HORIZONTAL";
  const styles: Record<string, string | undefined> = {};
  if (node.layoutSizingHorizontal === "FILL") {
    if (parentIsHorizontal) {
      styles["flex-grow"] = "1";
      styles["flex-basis"] = "0%";
    } else {
      styles["align-self"] = "stretch";
    }
    styles.width = "auto";
  } else if (node.layoutSizingHorizontal === "HUG") {
    styles.width = "auto";
  }
  if (node.layoutSizingVertical === "FILL") {
    if (parentIsHorizontal) {
      styles["align-self"] = "stretch";
    } else {
      styles["flex-grow"] = "1";
      styles["flex-basis"] = "0%";
    }
    styles.height = "auto";
  } else if (node.layoutSizingVertical === "HUG") {
    styles.height = "auto";
  }
  return styles;
}

// ---------------------------------------------------------------------------
// Node type classification
// ---------------------------------------------------------------------------

function needsImageFallback(
  node: FigmaNode,
  options: MapFigmaNodeOptions,
): boolean {
  if (options.forceImageFallbackNodeIds?.has(node.id)) return true;
  if (UNSUPPORTED_STRUCTURAL_TYPES.has(node.type)) return true;
  // A Figma mask affects its following siblings, not just the mask node. CSS
  // cannot reproduce that sibling-range operation on an arbitrary DOM tree,
  // so render the smallest containing subtree rather than importing a visibly
  // wrong unmasked composition. A mask imported as the root is also rendered.
  if (node.isMask || node.children?.some((child) => child.isMask)) return true;
  // A CSS div with an outline is not a Figma line. Partial/ring ellipses also
  // need real path geometry, which this structural mapper intentionally does
  // not request because geometry=paths makes ordinary REST payloads enormous.
  if (node.type === "LINE") return true;
  if (node.type === "ELLIPSE" && node.arcData) {
    const start = node.arcData.startingAngle ?? 0;
    const end = node.arcData.endingAngle ?? Math.PI * 2;
    const span = Math.abs(end - start);
    const isFullCircle =
      Math.abs(span - Math.PI * 2) < 1e-4 &&
      Math.abs(node.arcData.innerRadius ?? 0) < 1e-4;
    if (!isFullCircle) return true;
  }
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
    const hasAdvancedTypography = styles.some(
      (style) =>
        Math.abs(style.paragraphSpacing ?? 0) > 1e-6 ||
        Math.abs(style.paragraphIndent ?? 0) > 1e-6 ||
        Math.abs(style.listSpacing ?? 0) > 1e-6 ||
        style.hangingPunctuation === true ||
        style.hangingList === true ||
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

function frameRelativeBox(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
): { left: number; top: number; width: number; height: number } {
  const box = node.absoluteBoundingBox;
  if (!box) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: box.x - (parentBox?.x ?? box.x),
    top: box.y - (parentBox?.y ?? box.y),
    width: box.width,
    height: box.height,
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

function buildNode(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
  parentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL",
  options: MapFigmaNodeOptions,
  tracker: FidelityTracker,
  isRoot: boolean,
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
  if (rotation !== undefined) {
    // `box` (from absoluteBoundingBox) is the rotated shape's AABB; recover
    // the true pre-rotation width/height/position so fills/effects/strokes
    // below -- and the CSS `rotate()` applied later -- operate on the
    // correct box instead of an oversized one. See `unrotateBox`.
    box = unrotateBox(box, rotation);
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
  const isEllipse = node.type === "ELLIPSE";
  const box2 = { width: box.width, height: box.height };

  const fills = buildFills(
    node,
    node.fills,
    box2,
    options,
    tracker,
    isTextNode,
  );
  const strokeResult = buildStrokes(node, tracker);
  const effects = buildEffects(node, isTextNode, tracker);
  const cornerRadius = isEllipse ? "50%" : buildCornerRadius(node);
  const blendMode = buildBlendMode(node, tracker);

  const boxShadowParts = [...effects.boxShadowLayers];
  if (strokeResult.insetShadow) boxShadowParts.push(strokeResult.insetShadow);

  if (rotation !== undefined) {
    tracker.record(
      node,
      "approximated",
      `Rotation (${round(rotation, 2)}deg) reconstructed by pivoting the unrotated box about the absoluteBoundingBox center; exact only when Figma's internal pivot is also the shape's center.`,
    );
  }

  const autoLayoutStyles = buildAutoLayoutStyles(node);
  const childSizingStyles = buildChildSizingStyles(node, parentLayoutMode);
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
      rotation !== undefined ? `rotate(${round(-rotation, 3)}deg)` : undefined,
    "transform-origin": rotation !== undefined ? "center" : undefined,
    "min-width": px(node.minWidth ?? undefined),
    "max-width": px(node.maxWidth ?? undefined),
    "min-height": px(node.minHeight ?? undefined),
    "max-height": px(node.maxHeight ?? undefined),
    ...autoLayoutStyles,
    ...strokeResult.styles,
    ...childSizingStyles,
  };

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
    if (style.textAutoResize === "TRUNCATE") {
      baseStyles["white-space"] = "nowrap";
      baseStyles.overflow = "hidden";
      baseStyles["text-overflow"] = "ellipsis";
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

    const characters = node.characters ?? "";
    const textHtml = buildMixedTextHtml(node, characters, tracker);
    return `<div${idAttr}${typeAttr}${nameAttr}${semanticAttrs} style="${styleAttr(baseStyles)}"><span>${textHtml}</span></div>`;
  }

  tracker.record(
    node,
    "exact",
    "Position, size, fills, strokes, and effects mapped 1:1.",
  );

  // hasAutoLayout guarantees node.layoutMode is "HORIZONTAL" or "VERTICAL"
  // (buildAutoLayoutStyles returns {} -- no `display` -- for "NONE"/"GRID").
  const childParentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" =
    hasAutoLayout ? (node.layoutMode as "HORIZONTAL" | "VERTICAL") : "NONE";
  const childrenHtml = (node.children ?? [])
    .map((child) =>
      buildNode(
        child,
        node.absoluteBoundingBox ?? null,
        childParentLayoutMode,
        options,
        tracker,
        false,
      ),
    )
    .filter(Boolean)
    .join("\n");

  return `<div${idAttr}${typeAttr}${nameAttr}${semanticAttrs} style="${styleAttr(baseStyles)}">\n${childrenHtml}\n</div>`;
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
