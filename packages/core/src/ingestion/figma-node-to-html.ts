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
  showShadowBehindNode?: boolean;
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
  imageFillUrls?: Record<string, string>;
  imageFillSizes?: Record<string, { width: number; height: number }>;
  fallbackImageUrls?: Record<string, string>;
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

function styleAttr(styles: Record<string, string | undefined>): string {
  const parts = Object.entries(styles)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}: ${value}`);
  return escapeAttr(parts.join("; "));
}

class FidelityTracker {
  private entries = new Map<string, FidelityEntry>();

  record(node: FigmaNode, level: FidelityLevel, note: string) {
    const existing = this.entries.get(node.id);
    if (existing) {
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

function resolveGradientGeometry(paint: FigmaPaint): GradientHandles | null {
  return resolveGradientHandles(paint.gradientHandlePositions);
}

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
      const fromAngle = geometry
        ? gradientRayAngleDegreesFromHandles(geometry, { width: 1, height: 1 })
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

interface BackgroundResult {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  imageRendering?: string;
  overlayHtml?: string;
  color?: string;
}

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

interface PaintLayer {
  image: string;
  size: string;
  position: string;
  repeat: string;
}

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

function paintOverlayDiv(layer: PaintLayer, paint: FigmaPaint): string {
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
  box: { width: number; height: number },
  intrinsic: { width: number; height: number } | undefined,
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
      return {
        size:
          intrinsic && intrinsic.width > 0 && intrinsic.height > 0
            ? `${px(intrinsic.width)} ${px(intrinsic.height)}`
            : "auto",
        position: "top left",
        repeat: "repeat",
      };
    case "STRETCH": {
      const a = transform?.[0][0];
      const d = transform?.[1][1];
      if (
        isAxisAligned &&
        typeof a === "number" &&
        typeof d === "number" &&
        (a < -1e-6 || d < -1e-6)
      ) {
        tracker.record(
          node,
          "approximated",
          `Image fill's crop transform flips the artwork (${a < 0 ? "horizontally" : ""}${a < 0 && d < 0 ? " and " : ""}${d < 0 ? "vertically" : ""}); CSS background-size has no negative form, so the crop was approximated without the flip.`,
        );
      }
      if (
        isAxisAligned &&
        typeof a === "number" &&
        typeof d === "number" &&
        a > 1e-6 &&
        d > 1e-6 &&
        box.width > 0 &&
        box.height > 0
      ) {
        const displayWidth = box.width / a;
        const displayHeight = box.height / d;
        return {
          size: `${round(displayWidth, 2)}px ${round(displayHeight, 2)}px`,
          position: `${round(-(transform![0][2] ?? 0) * displayWidth, 2)}px ${round(-(transform![1][2] ?? 0) * displayHeight, 2)}px`,
          repeat: "no-repeat",
        };
      }
      return { size: "100% 100%", position: "center", repeat: "no-repeat" };
    }
    default:
      return { size: "cover", position: "center", repeat: "no-repeat" };
  }
}

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

  const ordered = [...visible].reverse();

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
        backgroundColor = color;
        continue;
      }
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
      const intrinsic = fill.imageRef
        ? options.imageFillSizes?.[fill.imageRef]
        : undefined;
      const mode = imageScaleModeCss(fill, node, tracker, box, intrinsic);
      layer = { image: `url("${url}")`, ...mode };
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
      const cssImage = paintToCssImage(fill, box, tracker, node);
      if (!cssImage) continue;
      overlays.push(angularGradientOverlay(cssImage, box, fill));
      continue;
    } else if (fill.type === "GRADIENT_DIAMOND") {
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
  if (magnified) result.imageRendering = "pixelated";
  if (overlays.length > 0) {
    result.overlayHtml = overlays.reverse().join("\n");
  }
  return result;
}

interface StrokeResult {
  styles: Record<string, string | undefined>;
  insetShadow?: string;
  strokeShadows?: string[];
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
    const align = node.strokeAlign ?? "INSIDE";
    const sides = [
      { weight: iw?.top ?? uniformWeight, x: 0, y: 1 },
      { weight: iw?.right ?? uniformWeight, x: -1, y: 0 },
      { weight: iw?.bottom ?? uniformWeight, x: 0, y: -1 },
      { weight: iw?.left ?? uniformWeight, x: 1, y: 0 },
    ];
    const bands: string[] = [];
    for (const side of sides) {
      if (!side.weight) continue;
      const inside = align === "CENTER" ? side.weight / 2 : side.weight;
      const outside = align === "CENTER" ? side.weight / 2 : 0;
      if (align !== "OUTSIDE" && inside) {
        bands.push(
          `inset ${px(side.x * inside)} ${px(side.y * inside)} 0 0 ${color}`,
        );
      }
      const out = align === "OUTSIDE" ? side.weight : outside;
      if (out) {
        bands.push(`${px(-side.x * out)} ${px(-side.y * out)} 0 0 ${color}`);
      }
    }
    tracker.record(
      node,
      "exact",
      `Per-side stroke weights rendered as one box-shadow band per side, placed for strokeAlign="${align}" and taking no space from the content box.`,
    );
    return { styles: {}, strokeShadows: bands };
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

interface EffectResult {
  boxShadowLayers: string[];
  filter?: string;
  backdropFilter?: string;
  contentShadow?: string;
}

export const FIGMA_BLUR_RADIUS_TO_CSS_BLUR = 0.45;

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
  const contentShadowLayers: string[] = [];
  const paintsOwnBox =
    (node.fills ?? []).some((fill) => fill.visible !== false) ||
    (node.strokes ?? []).some((stroke) => stroke.visible !== false);
  const dropShadows = effects.filter((effect) => effect.type === "DROP_SHADOW");
  const castsFromContentAlpha =
    !isTextNode &&
    !paintsOwnBox &&
    (node.children?.length ?? 0) > 0 &&
    dropShadows.length === 1 &&
    dropShadows[0]?.showShadowBehindNode === true;

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
      if (
        effect.type === "DROP_SHADOW" &&
        castsFromContentAlpha &&
        effect.showShadowBehindNode === true
      ) {
        const stdDev =
          px(
            Math.max(0, (effect.radius ?? 0) + (effect.spread ?? 0) * 2) / 2,
          ) ?? "0px";
        const cast = `drop-shadow(${x} ${y} ${stdDev} ${color})`;
        filter = filter ? `${filter} ${cast}` : cast;
        contentShadowLayers.push(
          `${color} ${x} ${y} ${blur}${spread}`.replace(/\s+/g, " ").trim(),
        );
        tracker.record(
          node,
          Math.abs(effect.spread ?? 0) > 1e-6 ? "approximated" : "exact",
          `DROP_SHADOW with showShadowBehindNode rendered as filter: drop-shadow(), which casts from the layer's own alpha and is not knocked out under its bounds${Math.abs(effect.spread ?? 0) > 1e-6 ? `; its ${effect.spread}px spread has no CSS equivalent and was folded into the blur radius` : ""}.`,
        );
        continue;
      }
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      boxShadowLayers.push(`${inset}${x} ${y} ${blur}${spread} ${color}`);
      tracker.record(
        node,
        "exact",
        `${effect.type} rendered as box-shadow${
          isTextNode
            ? ", which follows the text layer's box rather than its glyphs"
            : ""
        }.`,
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

  return {
    boxShadowLayers,
    filter,
    backdropFilter,
    contentShadow: contentShadowLayers.length
      ? contentShadowLayers.join(", ")
      : undefined,
  };
}

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
    return px(style.fontSize * (style.lineHeightPercentFontSize / 100));
  }
  if (typeof style.lineHeightPx === "number") {
    return px(style.lineHeightPx);
  }
  return undefined;
}

export function textTransformCss(
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

export function textUnderlinePositionCss(
  decoration: FigmaTypeStyle["textDecoration"],
): string | undefined {
  return decoration === "UNDERLINE" ? "under" : undefined;
}

export function textDecorationCss(
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

function resolveNegativeItemSpacing(node: FigmaNode): number {
  const spacing = node.itemSpacing ?? 0;
  if (spacing >= 0) return spacing;
  const horizontal = node.layoutMode === "HORIZONTAL";
  const mainSizing = horizontal
    ? node.layoutSizingHorizontal
    : node.layoutSizingVertical;
  if (mainSizing === "HUG") return spacing;
  const box = node.absoluteBoundingBox;
  if (!box) return spacing;
  const total = horizontal ? box.width : box.height;
  const padStart = (horizontal ? node.paddingLeft : node.paddingTop) ?? 0;
  const padEnd = (horizontal ? node.paddingRight : node.paddingBottom) ?? 0;
  const children = (node.children ?? []).filter(
    (child) =>
      child.visible !== false &&
      child.layoutPositioning !== "ABSOLUTE" &&
      child.absoluteBoundingBox,
  );
  if (children.length < 2) return spacing;
  let sum = 0;
  for (const child of children) {
    const size = horizontal
      ? child.absoluteBoundingBox!.width
      : child.absoluteBoundingBox!.height;
    if (typeof size !== "number") return spacing;
    sum += size;
  }
  const fill = (total - padStart - padEnd - sum) / (children.length - 1);
  return Math.max(spacing, fill);
}

function buildChildSizingStyles(
  node: FigmaNode,
  parentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL",
  parentItemSpacing = 0,
  isFirstChild = true,
  parentHugsMainAxis = false,
): Record<string, string | undefined> {
  if (parentLayoutMode === "NONE") return {};
  const parentIsHorizontal = parentLayoutMode === "HORIZONTAL";
  const styles: Record<string, string | undefined> = {};
  const mainAxisSizing = parentIsHorizontal
    ? node.layoutSizingHorizontal
    : node.layoutSizingVertical;
  if (mainAxisSizing !== "FILL") styles["flex-shrink"] = "0";
  if (parentItemSpacing < 0 && !isFirstChild) {
    styles[parentIsHorizontal ? "margin-left" : "margin-top"] =
      px(parentItemSpacing);
  }
  if (node.layoutSizingHorizontal === "FILL") {
    if (parentIsHorizontal) {
      if (parentHugsMainAxis) {
        styles.width = px(node.absoluteBoundingBox?.width ?? 0);
        styles["flex-shrink"] = "0";
      } else {
        styles["flex-grow"] = "1";
        styles["flex-basis"] = "0%";
        styles.width = "auto";
        if (node.minWidth === undefined) styles["min-width"] = "0";
      }
    } else {
      styles["align-self"] = "stretch";
      styles.width = "auto";
    }
  } else if (node.layoutSizingHorizontal === "HUG") {
    const roundedTextWidth =
      node.type === "TEXT" && node.minWidth === undefined
        ? node.absoluteBoundingBox?.width
        : undefined;
    if (roundedTextWidth !== undefined)
      styles["min-width"] = px(roundedTextWidth);
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
      styles.height = px(node.absoluteBoundingBox?.height ?? 0);
      styles["flex-shrink"] = "0";
    } else {
      styles["flex-grow"] = "1";
      styles["flex-basis"] = "0%";
      styles.height = "auto";
      if (node.minHeight === undefined) styles["min-height"] = "0";
    }
  } else if (node.layoutSizingVertical === "HUG") {
    const roundedTextHeight =
      node.type === "TEXT" && node.minHeight === undefined
        ? node.absoluteBoundingBox?.height
        : undefined;
    if (roundedTextHeight !== undefined)
      styles["min-height"] = px(roundedTextHeight);
    const pinsTextHeight =
      roundedTextHeight !== undefined &&
      node.style?.textAutoResize === "WIDTH_AND_HEIGHT";
    styles.height = pinsTextHeight
      ? px(roundedTextHeight)
      : hasContentToHug(node) && !hugIsCircularInCss(node, false)
        ? "auto"
        : px(node.absoluteBoundingBox?.height ?? 0);
  }
  return styles;
}

const VECTOR_GEOMETRY_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON",
  "LINE",
]);

const SVG_PAINT_TYPES = new Set([
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
]);

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

function vectorClipPath(
  node: FigmaNode,
  tracker: FidelityTracker,
): string | undefined {
  const source =
    (node.fillGeometry?.length ?? 0) > 0
      ? node.fillGeometry
      : node.strokeGeometry;
  const paths = (source ?? [])
    .map((entry) => entry.path?.trim())
    .filter((d): d is string => Boolean(d));
  if (paths.length === 0) {
    tracker.record(
      node,
      "approximated",
      "Background blur on a vector node was applied to its bounding box: the node has no fillGeometry to clip the blur to its own silhouette.",
    );
    return undefined;
  }
  const rule = source?.[0]?.windingRule === "EVENODD" ? "evenodd, " : "";
  return `path(${rule}"${paths.join(" ").replace(/"/g, "'")}")`;
}

function rendersVectorGeometry(
  node: FigmaNode,
  options: MapFigmaNodeOptions,
): boolean {
  if (options.forceImageFallbackNodeIds?.has(node.id)) return false;
  const isArcEllipse = node.type === "ELLIPSE" && !isFullCircleArc(node);
  if (!VECTOR_GEOMETRY_TYPES.has(node.type) && !isArcEllipse) return false;
  const box = node.absoluteBoundingBox;
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
  const strokeStart = paths.length;
  emit(node.strokeGeometry, node.strokes, "stroke");
  if (
    node.strokeAlign === "INSIDE" &&
    paths.length > strokeStart &&
    (node.fillGeometry?.length ?? 0) > 0
  ) {
    const clipId = `stroke-inside-${node.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    defs.push(
      `<clipPath id="${clipId}">` +
        (node.fillGeometry ?? [])
          .map((entry) =>
            entry.path?.trim()
              ? `<path d="${escapeAttr(entry.path.trim())}"${entry.windingRule === "EVENODD" ? ' clip-rule="evenodd"' : ""} />`
              : "",
          )
          .join("") +
        `</clipPath>`,
    );
    const stroked = paths.splice(strokeStart).join("");
    paths.push(`<g clip-path="url(#${clipId})">${stroked}</g>`);
  }

  if (paths.length === 0) return null;
  const defsMarkup = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
  const strokeBand = Math.max(node.strokeWeight ?? 0, 1);
  const viewWidth = box.width > 0 ? box.width : strokeBand;
  const viewHeight = box.height > 0 ? box.height : strokeBand;
  const originX = box.width > 0 ? 0 : -viewWidth / 2;
  const originY = box.height > 0 ? 0 : -viewHeight / 2;
  const sizing =
    box.width > 0 && box.height > 0
      ? `width="100%" height="100%"`
      : `width="${round(viewWidth, 2)}" height="${round(viewHeight, 2)}"`;
  const placement =
    originX || originY
      ? `position: absolute; left: ${round(originX, 2)}px; top: ${round(originY, 2)}px; `
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" ${sizing} viewBox="${round(originX, 2)} ${round(originY, 2)} ${round(viewWidth, 2)} ${round(viewHeight, 2)}" fill="none" style="${placement}overflow: visible; display: block">${defsMarkup}${paths.join("")}</svg>`;
}

export function hasPrivateUseCharacters(text: string | undefined): boolean {
  if (!text) return false;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
      (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
      (codePoint >= 0x100000 && codePoint <= 0x10fffd)
    ) {
      return true;
    }
  }
  return false;
}

function needsImageFallback(
  node: FigmaNode,
  options: MapFigmaNodeOptions,
): boolean {
  if (options.forceImageFallbackNodeIds?.has(node.id)) return true;
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
  if (rendersVectorGeometry(node, options)) return false;
  if (UNSUPPORTED_STRUCTURAL_TYPES.has(node.type)) return true;
  if (node.type === "LINE") return true;
  if (node.type === "ELLIPSE" && !isFullCircleArc(node)) return true;
  if (node.type === "TEXT" && hasPrivateUseCharacters(node.characters)) {
    return true;
  }
  const visibleStrokes = (node.strokes ?? []).filter(
    (stroke) => stroke.visible !== false,
  );
  if (
    visibleStrokes.length > 1 ||
    visibleStrokes.some((stroke) => stroke.type !== "SOLID")
  ) {
    return true;
  }
  if ((node.strokeDashes?.length ?? 0) > 0) return true;
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
    const paragraphCount =
      node.lineTypes?.length ??
      figmaDrawnText(node.characters ?? "", undefined).split(FIGMA_TEXT_BREAK)
        .length;
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
      return;
    }
    if (rendersVectorGeometry(current, options)) return;
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return ids;
}

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

export function figmaLaidOutOneLine(node: FigmaNode): boolean {
  const lineHeight = node.style?.lineHeightPx;
  const height = node.absoluteBoundingBox?.height;
  if (!lineHeight || !height) return false;
  return (
    (node.lineTypes?.length ?? 1) === 1 && Math.round(height / lineHeight) === 1
  );
}

const FIGMA_TEXT_BREAK = /\r\n|[\n\r\u2028\u2029]/g;

export function figmaDrawnText(
  text: string,
  laidOutLines: number | undefined,
): string {
  const breaks = [...text.matchAll(FIGMA_TEXT_BREAK)];
  if (laidOutLines === undefined) {
    return text.replace(/\s+$/, "");
  }
  if (breaks.length + 1 <= laidOutLines) return text.replace(/[ \t]+$/, "");
  let drawn = text;
  for (const match of breaks.slice(Math.max(0, laidOutLines - 1))) {
    const at = match.index ?? 0;
    drawn =
      drawn.slice(0, at) +
      " ".repeat(match[0].length) +
      drawn.slice(at + match[0].length);
  }
  return drawn.replace(/[ \t]+$/, "");
}

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

interface LocalBox {
  left: number;
  top: number;
  width: number;
  height: number;
  exact: boolean;
}

function frameRelativeBox(
  node: FigmaNode,
  parentBox: FigmaBoundingBox | null,
): LocalBox {
  const transform = node.relativeTransform;
  const size = node.size;
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

function unrotateBox(
  box: { left: number; top: number; width: number; height: number },
  rotationDeg: number,
): { left: number; top: number; width: number; height: number } {
  const theta = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const det = c * c - s * s;
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
  parentItemSpacing = 0,
  isFirstChild = true,
  parentHugsMainAxis = false,
): string {
  const parentHasAutoLayout = parentLayoutMode !== "NONE";
  if (node.visible === false || node.opacity === 0) return "";

  let box = frameRelativeBox(node, parentBox);
  const rotationDeg =
    typeof node.rotation === "number"
      ? (node.rotation * 180) / Math.PI
      : undefined;
  const rotation =
    rotationDeg !== undefined && Math.abs(rotationDeg) > 0.001
      ? rotationDeg
      : undefined;
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
    const renderBox = frameRelativeRenderBox(node, parentBox);
    const overflow = isFlowChild
      ? {
          left: box.left - renderBox.left,
          top: box.top - renderBox.top,
          right: renderBox.left + renderBox.width - (box.left + box.width),
          bottom: renderBox.top + renderBox.height - (box.top + box.height),
        }
      : null;
    const negativeMargin = (value: number | undefined) =>
      value !== undefined && Math.abs(value) > 1e-6 ? px(-value) : undefined;
    const styles: Record<string, string | undefined> = {
      position: isRoot || isFlowChild ? "relative" : "absolute",
      left: isRoot || isFlowChild ? undefined : px(renderBox.left),
      top: isRoot || isFlowChild ? undefined : px(renderBox.top),
      width: px(renderBox.width),
      height: px(renderBox.height),
      "object-fit": "contain",
      "object-position": "0 0",
      "margin-left": negativeMargin(overflow?.left),
      "margin-top": negativeMargin(overflow?.top),
      "margin-right": negativeMargin(overflow?.right),
      "margin-bottom": negativeMargin(overflow?.bottom),
      opacity:
        typeof node.opacity === "number" && node.opacity !== 1
          ? String(round(node.opacity, 4))
          : undefined,
    };
    return `<img${idAttr}${typeAttr}${nameAttr}${semanticAttrs} src="${escapeAttr(imageUrl)}" alt="${escapeAttr(node.name ?? "")}" style="${styleAttr(styles)}" />`;
  }

  const isTextNode = node.type === "TEXT";
  const box2 = { width: box.width, height: box.height };
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
  const contentShadowProperty = effects.contentShadow;
  if (strokeResult.insetShadow) boxShadowParts.push(strokeResult.insetShadow);
  if (strokeResult.strokeShadows)
    boxShadowParts.push(...strokeResult.strokeShadows);

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
    "--figma-content-shadow": contentShadowProperty,
    filter: effects.filter,
    "backdrop-filter": effects.backdropFilter,
    "-webkit-backdrop-filter": effects.backdropFilter,
    "clip-path":
      isVector && effects.backdropFilter
        ? vectorClipPath(node, tracker)
        : undefined,
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
    baseStyles["text-underline-position"] = textUnderlinePositionCss(
      style.textDecoration,
    );
    baseStyles["text-align"] = textAlignCss(style.textAlignHorizontal);
    const spanStyles: Record<string, string | undefined> = {};
    if (style.textAutoResize === "TRUNCATE") {
      baseStyles["white-space"] = "nowrap";
      baseStyles.overflow = "hidden";
      spanStyles.display = "block";
      spanStyles.overflow = "hidden";
      spanStyles["text-overflow"] = "ellipsis";
      spanStyles["min-width"] = "0";
    } else if (figmaLaidOutOneLine(node)) {
      baseStyles["white-space"] = "pre";
    } else {
      baseStyles["white-space"] = "pre-wrap";
    }
    baseStyles.display = "flex";
    baseStyles["flex-direction"] = "column";
    baseStyles["justify-content"] = verticalAlignJustifyContent(
      style.textAlignVertical,
    );
    tracker.record(node, "exact", "Text styling mapped from TypeStyle fields.");

    const characters = figmaDrawnText(
      node.characters ?? "",
      node.lineTypes?.length,
    );
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

  const childParentLayoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" =
    hasAutoLayout ? (node.layoutMode as "HORIZONTAL" | "VERTICAL") : "NONE";
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
            hasAutoLayout ? resolveNegativeItemSpacing(node) : 0,
            index === 0,
            hasAutoLayout && hugsMainAxis(node),
          ),
        )
        .filter(Boolean)
        .join("\n");

  const innerHtml = [fills.overlayHtml, childrenHtml]
    .filter(Boolean)
    .join("\n");

  return `<div${idAttr}${typeAttr}${nameAttr}${semanticAttrs} style="${styleAttr(baseStyles)}">\n${innerHtml}\n</div>`;
}

export function mapFigmaNodeToHtml(
  node: FigmaNode,
  options: MapFigmaNodeOptions = {},
): MapFigmaNodeResult {
  assertFigmaNodeTreeComplexity(node);
  const tracker = new FidelityTracker();
  const html = buildNode(node, null, "NONE", options, tracker, true);
  return { html, fidelity: tracker.build() };
}
