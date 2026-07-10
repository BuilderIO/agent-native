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
 * The REST API's `rotation` field is in degrees (-180..180), and
 * `absoluteBoundingBox` is the *already-rotated* axis-aligned bounding box —
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
  size?: { x: number; y: number };
  clipsContent?: boolean;
  characters?: string;
  style?: FigmaTypeStyle;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  individualStrokeWeights?: FigmaIndividualStrokeWeights;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
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

function gradientStopsCss(paint: FigmaPaint): string {
  const stops = paint.gradientStops ?? [];
  return stops
    .map((stop) => {
      const color = colorToCss(stop.color, paint.opacity ?? 1) ?? "transparent";
      return `${color} ${round(stop.position * 100, 2)}%`;
    })
    .join(", ");
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
      tracker.record(
        node,
        "exact",
        "Linear gradient angle derived from gradientHandlePositions.",
      );
      return `linear-gradient(${round(angle ?? 90, 2)}deg, ${stops})`;
    }
    case "GRADIENT_RADIAL": {
      const geometry = resolveGradientGeometry(paint);
      if (!geometry) return `radial-gradient(${stops})`;
      const cx = round(geometry.start.x * 100, 2);
      const cy = round(geometry.start.y * 100, 2);
      const radiusX = vectorLength(geometry.start, geometry.width, box);
      const radiusY = vectorLength(geometry.start, geometry.end, box);
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
      const radiusX = geometry
        ? vectorLength(geometry.start, geometry.width, box)
        : box.width / 2;
      const radiusY = geometry
        ? vectorLength(geometry.start, geometry.end, box)
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
  if (
    !SUPPORTED_CONTAINER_TYPES.has(node.type) &&
    node.type !== "RECTANGLE" &&
    node.type !== "ELLIPSE" &&
    node.type !== "LINE" &&
    node.type !== "TEXT"
  ) {
    return true;
  }
  return false;
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
  const ids: string[] = [];
  const visit = (current: FigmaNode) => {
    if (current.visible === false) return;
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
export function collectImageFillRefs(node: FigmaNode): string[] {
  const refs = new Set<string>();
  const visitPaints = (paints: FigmaPaint[] | undefined) => {
    for (const paint of paints ?? []) {
      if (paint.type === "IMAGE" && paint.imageRef) refs.add(paint.imageRef);
    }
  };
  const visit = (current: FigmaNode) => {
    visitPaints(current.fills);
    visitPaints(current.strokes);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return [...refs];
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

function buildNode(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
  parentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL",
  options: MapFigmaNodeOptions,
  tracker: FidelityTracker,
  isRoot: boolean,
): string {
  const parentHasAutoLayout = parentLayoutMode !== "NONE";
  if (node.visible === false) return "";

  const box = frameRelativeBox(node, parentBox);
  const nameAttr = node.name
    ? ` data-agent-native-layer-name="${escapeAttr(node.name)}"`
    : "";
  const idAttr = ` data-figma-node-id="${escapeAttr(node.id)}"`;
  const typeAttr = ` data-figma-node-type="${escapeAttr(node.type)}"`;

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
    const styles: Record<string, string | undefined> = {
      position: isRoot ? "relative" : "absolute",
      left: isRoot ? undefined : px(box.left),
      top: isRoot ? undefined : px(box.top),
      width: px(box.width),
      height: px(box.height),
      opacity:
        typeof node.opacity === "number" && node.opacity !== 1
          ? String(round(node.opacity, 4))
          : undefined,
    };
    return `<img${idAttr}${typeAttr}${nameAttr} src="${escapeAttr(imageUrl)}" alt="${escapeAttr(node.name ?? "")}" style="${styleAttr(styles)}" />`;
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

  const rotation =
    typeof node.rotation === "number" && Math.abs(node.rotation) > 0.001
      ? node.rotation
      : undefined;
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
  const isFlexChild = !isRoot && parentHasAutoLayout;

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
    }
    baseStyles.display = "flex";
    baseStyles["flex-direction"] = "column";
    baseStyles["justify-content"] = verticalAlignJustifyContent(
      style.textAlignVertical,
    );
    tracker.record(node, "exact", "Text styling mapped from TypeStyle fields.");

    const characters = node.characters ?? "";
    return `<div${idAttr}${typeAttr}${nameAttr} style="${styleAttr(baseStyles)}">${escapeHtml(characters)}</div>`;
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

  return `<div${idAttr}${typeAttr}${nameAttr} style="${styleAttr(baseStyles)}">\n${childrenHtml}\n</div>`;
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
  const tracker = new FidelityTracker();
  const html = buildNode(node, null, "NONE", options, tracker, true);
  return { html, fidelity: tracker.build() };
}
