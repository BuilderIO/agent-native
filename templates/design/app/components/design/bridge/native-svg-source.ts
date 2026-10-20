import { classifyNativeComputedOverflowClip } from "../../../../shared/native-source-clip-plan";
import {
  planNativeCaptureRoi,
  setNativeCaptureRoi,
  type NativeCaptureRoi,
} from "./native-capture-roi";
import type { NativeAffine2D } from "./native-source-affine-geometry";
import {
  MAX_NATIVE_SVG_PATTERN_WORK,
  planNativeSvgPatternWork,
} from "./native-svg-pattern-work";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SVG_ELEMENTS = 256;
const MAX_SVG_SOURCE_BYTES = 262_144;
const MAX_SVG_SIDE = 4096;
const MAX_SVG_PIXELS = 8_388_608;
const MAX_PATTERN_SIDE = 1024;
const MAX_PATTERN_PIXELS = 262_144;

const SVG_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "pattern",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
]);

const SVG_ATTRIBUTES = new Set([
  "id",
  "viewBox",
  "preserveAspectRatio",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "dx",
  "dy",
  "rotate",
  "transform",
  "gradientUnits",
  "gradientTransform",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "spreadMethod",
  "offset",
  "pathLength",
]);

const SVG_STYLES = [
  ["fill", "fill"],
  ["fill-rule", "fillRule"],
  ["stroke", "stroke"],
  ["stroke-width", "strokeWidth"],
  ["stroke-linecap", "strokeLinecap"],
  ["stroke-linejoin", "strokeLinejoin"],
  ["stroke-miterlimit", "strokeMiterlimit"],
  ["stroke-dasharray", "strokeDasharray"],
  ["stroke-dashoffset", "strokeDashoffset"],
  ["color", "color"],
  ["color-interpolation", "colorInterpolation"],
  ["opacity", "opacity"],
  ["fill-opacity", "fillOpacity"],
  ["stroke-opacity", "strokeOpacity"],
  ["stop-color", "stopColor"],
  ["stop-opacity", "stopOpacity"],
  ["clip-path", "clipPath"],
  ["font-family", "fontFamily"],
  ["font-size", "fontSize"],
  ["font-style", "fontStyle"],
  ["font-weight", "fontWeight"],
  ["letter-spacing", "letterSpacing"],
  ["text-anchor", "textAnchor"],
  ["dominant-baseline", "dominantBaseline"],
  ["visibility", "visibility"],
  ["display", "display"],
  ["vector-effect", "vectorEffect"],
  ["paint-order", "paintOrder"],
  ["shape-rendering", "shapeRendering"],
  ["text-rendering", "textRendering"],
  ["white-space", "whiteSpace"],
  ["word-spacing", "wordSpacing"],
  ["font-kerning", "fontKerning"],
  ["transform", "transform"],
  ["transform-origin", "transformOrigin"],
  ["x", "x"],
  ["y", "y"],
  ["width", "width"],
  ["height", "height"],
  ["cx", "cx"],
  ["cy", "cy"],
  ["r", "r"],
  ["rx", "rx"],
  ["ry", "ry"],
] as const;
const SVG_PRESENTATION_ATTRIBUTES = new Set<string>(
  SVG_STYLES.map(([name]) => name),
);
const SVG_CSS_GEOMETRY = new Set([
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
]);
const SVG_CSS_GEOMETRY_BY_TAG: Record<string, ReadonlySet<string>> = {
  svg: new Set(["x", "y", "width", "height"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry"]),
  circle: new Set(["cx", "cy", "r"]),
  ellipse: new Set(["cx", "cy", "rx", "ry"]),
};

export class NativeSvgSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeSvgSourceError";
  }
}

function authoredSvgOpacity(
  element: Element,
  style: CSSStyleDeclaration,
): string {
  const value =
    element.getAttribute("data-an-native-authored-opacity") ?? style.opacity;
  const opacity = Number(value);
  if (!value?.trim() || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    throw new NativeSvgSourceError(
      "source-svg-opacity-invalid",
      "Authored SVG opacity is not a finite value in [0, 1].",
    );
  return value;
}

function localPaintReferences(value: string, ids: Set<string>): string {
  return value.replace(/url\(([^)]+)\)/gi, (_match, quoted: string) => {
    const raw = quoted.trim().replace(/^["']|["']$/g, "");
    const hash = raw.indexOf("#");
    if (hash < 0)
      throw new NativeSvgSourceError(
        "source-svg-external-asset",
        "An SVG paint references an external asset.",
      );
    if (hash > 0) {
      let location: URL;
      let current: URL;
      try {
        location = new URL(raw.slice(0, hash), document.baseURI);
        current = new URL(document.baseURI);
      } catch {
        throw new NativeSvgSourceError(
          "source-svg-external-asset",
          "An SVG paint has an unreadable asset reference.",
        );
      }
      if (
        location.origin !== current.origin ||
        location.pathname !== current.pathname ||
        location.search !== current.search
      )
        throw new NativeSvgSourceError(
          "source-svg-external-asset",
          "An SVG paint references a different document.",
        );
    }
    const id = raw.slice(hash + 1);
    if (!ids.has(id))
      throw new NativeSvgSourceError(
        "source-svg-reference-unresolved",
        "An SVG paint reference is outside the captured SVG.",
      );
    return `url(#${id})`;
  });
}

function assertFontSupported(style: CSSStyleDeclaration): void {
  const unsupportedTextStyles: Array<[string, string | undefined, string[]]> = [
    ["font-stretch", style.fontStretch, ["normal", "100%"]],
    ["font-variant", style.fontVariant, ["normal"]],
    ["font-variant-caps", style.fontVariantCaps, ["normal"]],
    ["font-variant-ligatures", style.fontVariantLigatures, ["normal"]],
    ["font-variant-numeric", style.fontVariantNumeric, ["normal"]],
    ["font-variant-east-asian", style.fontVariantEastAsian, ["normal"]],
    ["font-feature-settings", style.fontFeatureSettings, ["normal"]],
    ["font-variation-settings", style.fontVariationSettings, ["normal"]],
    ["text-decoration-line", style.textDecorationLine, ["none"]],
    ["text-transform", style.textTransform, ["none"]],
    ["text-shadow", style.textShadow, ["none"]],
  ];
  for (const [name, value, supported] of unsupportedTextStyles) {
    if (!value || !supported.includes(value.trim().toLowerCase()))
      throw new NativeSvgSourceError(
        "source-svg-text-style-unsupported",
        `SVG text ${name} cannot be captured faithfully.`,
      );
  }
  const names = style.fontFamily
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  if (
    names.some(
      (name) =>
        !["sans-serif", "serif", "monospace", "system-ui"].includes(name),
    )
  )
    throw new NativeSvgSourceError(
      "source-svg-font-unsupported",
      "SVG text uses a font that cannot be embedded in the captured image.",
    );
}

function patternLength(value: string | null): number | null {
  if (
    !value ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(value.trim())
  )
    return null;
  const length = Number.parseFloat(value);
  return Number.isFinite(length) ? length : null;
}

function assertBoundedPattern(pattern: Element): void {
  const width = patternLength(pattern.getAttribute("width"));
  const height = patternLength(pattern.getAttribute("height"));
  const x = pattern.hasAttribute("x")
    ? patternLength(pattern.getAttribute("x"))
    : 0;
  const y = pattern.hasAttribute("y")
    ? patternLength(pattern.getAttribute("y"))
    : 0;
  const style = getComputedStyle(pattern);
  if (
    pattern.getAttribute("patternUnits") !== "userSpaceOnUse" ||
    ![null, "userSpaceOnUse"].includes(
      pattern.getAttribute("patternContentUnits"),
    ) ||
    pattern.hasAttribute("href") ||
    pattern.hasAttribute("xlink:href") ||
    pattern.hasAttribute("patternTransform") ||
    pattern.hasAttribute("transform") ||
    pattern.parentElement?.closest("pattern") ||
    width === null ||
    height === null ||
    x === null ||
    y === null ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_PATTERN_SIDE ||
    height > MAX_PATTERN_SIDE ||
    width * height > MAX_PATTERN_PIXELS ||
    Math.abs(x) > MAX_SVG_SIDE ||
    Math.abs(y) > MAX_SVG_SIDE ||
    !style.transform ||
    style.transform !== "none" ||
    style.overflowX !== "hidden" ||
    style.overflowY !== "hidden"
  )
    throw new NativeSvgSourceError(
      "source-svg-pattern-unsupported",
      "source-svg-pattern-unsupported",
    );
  if (pattern.hasAttribute("viewBox")) {
    const values = pattern
      .getAttribute("viewBox")!
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length !== 4 ||
      values.some((value) => !Number.isFinite(value)) ||
      values[2] <= 0 ||
      values[3] <= 0 ||
      values.some((value) => Math.abs(value) > MAX_SVG_SIDE)
    )
      throw new NativeSvgSourceError(
        "source-svg-pattern-unsupported",
        "source-svg-pattern-unsupported",
      );
  }
}

function assertLocalResourceGraph(root: Element): {
  byId: Map<string, Element>;
  edges: Map<Element, Element[]>;
} {
  const elements = [root, ...root.querySelectorAll("*")];
  const byId = new Map<string, Element>();
  const edges = new Map<Element, Element[]>();
  const painted = new Set([
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
  ]);
  const paintServers = new Set(["linearGradient", "radialGradient", "pattern"]);
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (id) byId.set(id, element);
    edges.set(element, [...element.children]);
  }
  for (const element of elements) {
    for (const property of ["fill", "stroke", "clip-path"]) {
      if (
        property !== "clip-path" &&
        (!painted.has(element.localName) || element.closest("clipPath"))
      )
        continue;
      const value = element.getAttribute(property) ?? "";
      for (const match of value.matchAll(/url\(#([^)]+)\)/g)) {
        const resource = byId.get(match[1]);
        if (
          !resource ||
          (property === "clip-path"
            ? resource.localName !== "clipPath"
            : !paintServers.has(resource.localName))
        )
          throw new NativeSvgSourceError(
            "source-svg-reference-kind-unsupported",
            "source-svg-reference-kind-unsupported",
          );
        edges.get(element)!.push(resource);
      }
    }
  }
  const visiting = new Set<Element>();
  const visited = new Set<Element>();
  const visit = (element: Element): void => {
    if (visiting.has(element))
      throw new NativeSvgSourceError(
        "source-svg-reference-cycle",
        "source-svg-reference-cycle",
      );
    if (visited.has(element)) return;
    visiting.add(element);
    for (const dependency of edges.get(element)!) visit(dependency);
    visiting.delete(element);
    visited.add(element);
  };
  for (const element of elements) visit(element);
  return { byId, edges };
}

function assertNativeSvgElements(root: Element): Element[] {
  const descendants = [root, ...root.querySelectorAll("*")];
  if (descendants.length > MAX_SVG_ELEMENTS)
    throw new NativeSvgSourceError(
      "source-svg-complex",
      "An SVG source has too many elements to capture.",
    );
  const ids = new Set<string>();
  for (const element of descendants) {
    if (element.namespaceURI !== SVG_NS || !SVG_TAGS.has(element.localName))
      throw new NativeSvgSourceError(
        "source-svg-element-unsupported",
        `SVG element ${element.localName} needs a separate source path.`,
      );
    if (element.localName === "pattern") assertBoundedPattern(element);
    const id = element.getAttribute("id");
    if (id) {
      if (ids.has(id))
        throw new NativeSvgSourceError(
          "source-svg-id-duplicate",
          "An SVG source has duplicate paint reference IDs.",
        );
      ids.add(id);
    }
  }
  return descendants;
}

const STATIC_SVG_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
]);
const STATIC_SVG_PAINTED_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);

export function validateNativeSvgPrimitiveMarkup(
  markup: string,
): "immutable" | "unknown" {
  if (new TextEncoder().encode(markup).length > MAX_SVG_SOURCE_BYTES)
    return "unknown";
  try {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = parsed.documentElement;
    if (
      parsed.doctype ||
      root.localName !== "svg" ||
      root.namespaceURI !== SVG_NS ||
      parsed.querySelector("parsererror")
    )
      return "unknown";
    const elements = assertNativeSvgElements(root);
    for (const element of elements) {
      if (!STATIC_SVG_TAGS.has(element.localName)) return "unknown";
      for (const attribute of element.attributes) {
        const name = attribute.name;
        if (
          name === "xmlns" ||
          name === "xmlns:xlink" ||
          name === "role" ||
          name.startsWith("aria-") ||
          name.startsWith("data-")
        )
          continue;
        if (!SVG_ATTRIBUTES.has(name) && !SVG_PRESENTATION_ATTRIBUTES.has(name))
          return "unknown";
        if (/var\s*\(|calc\s*\(|attr\s*\(/i.test(attribute.value))
          return "unknown";
        if (/url\s*\(/i.test(attribute.value)) {
          const checkedPaint =
            (name === "fill" || name === "stroke") &&
            STATIC_SVG_PAINTED_TAGS.has(element.localName) &&
            !element.closest("clipPath");
          if (
            (!checkedPaint && name !== "clip-path") ||
            !/^url\(#[A-Za-z_][\w.-]*\)$/.test(attribute.value)
          )
            return "unknown";
        }
      }
    }
    const viewBox = root.getAttribute("viewBox");
    if (viewBox) {
      const values = viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        values.length !== 4 ||
        values.some((value) => !Number.isFinite(value)) ||
        values[2] <= 0 ||
        values[3] <= 0 ||
        values[2] > MAX_SVG_SIDE ||
        values[3] > MAX_SVG_SIDE ||
        values[2] * values[3] > MAX_SVG_PIXELS
      )
        return "unknown";
    }
    assertLocalResourceGraph(root);
    return "immutable";
  } catch {
    return "unknown";
  }
}

function patternWorkLimit(): never {
  throw new NativeSvgSourceError(
    "source-svg-pattern-work-limit",
    "source-svg-pattern-work-limit",
  );
}

function assertPatternWorkBudget(
  original: SVGSVGElement,
  clone: Element,
  originals: Map<Element, Element>,
  graph: { byId: Map<string, Element>; edges: Map<Element, Element[]> },
  size: { width: number; height: number },
  captureSize: { width: number; height: number },
): void {
  if (!clone.querySelector("pattern")) return;
  const viewport = original.getBoundingClientRect();
  if (
    ![viewport.left, viewport.top, viewport.width, viewport.height].every(
      Number.isFinite,
    ) ||
    viewport.width !== size.width ||
    viewport.height !== size.height ||
    !Number.isFinite(captureSize.width) ||
    !Number.isFinite(captureSize.height) ||
    captureSize.width < size.width ||
    captureSize.height < size.height
  )
    patternWorkLimit();
  for (
    let ancestor: Element | null = original;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (
      style.transform !== "none" ||
      style.rotate !== "none" ||
      style.scale !== "none" ||
      style.perspective !== "none" ||
      style.transformStyle !== "flat" ||
      !["1", "normal"].includes(style.zoom) ||
      (ancestor === original && original.hasAttribute("transform"))
    )
      patternWorkLimit();
  }
  const costs = new Map<Element, number>();
  const cost = (element: Element): number => {
    const existing = costs.get(element);
    if (existing !== undefined) return existing;
    let nodes = 1;
    for (const dependency of graph.edges.get(element)!) {
      const next = cost(dependency);
      if (nodes > MAX_NATIVE_SVG_PATTERN_WORK - next) patternWorkLimit();
      nodes += next;
    }
    costs.set(element, nodes);
    return nodes;
  };
  let total = 0;
  const painted = new Set([
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
  ]);
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    if (!painted.has(element.localName) || element.closest("clipPath"))
      continue;
    for (const property of ["fill", "stroke"]) {
      for (const match of (element.getAttribute(property) ?? "").matchAll(
        /url\(#([^)]+)\)/g,
      )) {
        const pattern = graph.byId.get(match[1])!;
        if (pattern.localName !== "pattern") continue;
        if (element.closest("pattern")) patternWorkLimit();
        const source = originals.get(element) as SVGGraphicsElement;
        if (!source || typeof source.getScreenCTM !== "function")
          patternWorkLimit();
        let matrix: DOMMatrix | null;
        try {
          matrix = source.getScreenCTM();
        } catch {
          patternWorkLimit();
        }
        if (!matrix || !matrix.is2D) patternWorkLimit();
        let width: number;
        let height: number;
        try {
          const sourcePattern = originals.get(pattern) as SVGPatternElement;
          width = sourcePattern.width.baseVal.value;
          height = sourcePattern.height.baseVal.value;
        } catch {
          patternWorkLimit();
        }
        if (
          width > MAX_PATTERN_SIDE ||
          height > MAX_PATTERN_SIDE ||
          width * height > MAX_PATTERN_PIXELS
        )
          patternWorkLimit();
        const work = planNativeSvgPatternWork({
          viewport: captureSize,
          localToScreen: matrix,
          tile: { width, height },
          resourceNodes: cost(pattern),
        });
        if (!work.ok || total > MAX_NATIVE_SVG_PATTERN_WORK - work.workUnits)
          patternWorkLimit();
        total += work.workUnits;
      }
    }
  }
}

export function serializeNativeSvgSource(
  root: SVGSVGElement,
  size: { width: number; height: number },
  captureSize: { width: number; height: number } = size,
  paint?: "fill" | "stroke" | "coverage",
  boundedVectorGroup = false,
): string {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > MAX_SVG_SIDE ||
    size.height > MAX_SVG_SIDE ||
    size.width * size.height > MAX_SVG_PIXELS
  )
    throw new NativeSvgSourceError(
      "source-svg-size",
      "An SVG source exceeds bounded raster dimensions.",
    );
  const descendants = assertNativeSvgElements(root);
  const ids = new Set(
    descendants
      .map((element) => element.getAttribute("id"))
      .filter((id): id is string => Boolean(id)),
  );
  const rootStyle = getComputedStyle(root);
  const background = rootStyle.backgroundColor
    ?.replace(/\s+/g, "")
    .toLowerCase();
  if (
    (background &&
      background !== "transparent" &&
      !/^rgba\([^)]*,0(?:\.0+)?\)$/.test(background)) ||
    (rootStyle.backgroundImage && rootStyle.backgroundImage !== "none") ||
    (rootStyle.boxShadow && rootStyle.boxShadow !== "none") ||
    (rootStyle.outlineStyle && rootStyle.outlineStyle !== "none") ||
    [
      rootStyle.borderTopWidth,
      rootStyle.borderRightWidth,
      rootStyle.borderBottomWidth,
      rootStyle.borderLeftWidth,
    ].some((width) => width && Number.parseFloat(width) > 0)
  )
    throw new NativeSvgSourceError(
      "source-svg-box-paint-unsupported",
      "An SVG root has CSS box paint outside its vector source.",
    );
  const zeroRadius = (value: string): boolean =>
    value
      .trim()
      .split(/\s+/)
      .every((part) => /^0(?:\.0+)?(?:px|%)?$/.test(part));
  if (
    [
      rootStyle.borderTopLeftRadius,
      rootStyle.borderTopRightRadius,
      rootStyle.borderBottomRightRadius,
      rootStyle.borderBottomLeftRadius,
    ].some((radius) => !radius || !zeroRadius(radius))
  )
    throw new NativeSvgSourceError(
      "source-svg-root-radius-unsupported",
      "An SVG root needs a rounded vector viewport clip.",
    );
  const overflowClip = classifyNativeComputedOverflowClip(rootStyle);
  if (!overflowClip.ok)
    throw new NativeSvgSourceError(
      `source-svg-${overflowClip.reason}`,
      overflowClip.detail,
    );
  if (
    overflowClip.edge === "none" &&
    !(boundedVectorGroup && paint === "coverage")
  )
    throw new NativeSvgSourceError(
      "source-svg-overflow-unsupported",
      "An SVG root needs a bounded vector viewport clip.",
    );
  if (
    [
      rootStyle.paddingTop,
      rootStyle.paddingRight,
      rootStyle.paddingBottom,
      rootStyle.paddingLeft,
    ].some((padding) => !padding || !zeroRadius(padding))
  )
    throw new NativeSvgSourceError(
      "source-svg-box-paint-unsupported",
      "An SVG root has CSS padding outside its vector viewport.",
    );
  const supportsCssGeometry = (element: Element, name: string): boolean =>
    !!SVG_CSS_GEOMETRY_BY_TAG[element.localName]?.has(name) &&
    !(
      element !== root &&
      element.localName === "svg" &&
      (name === "width" || name === "height")
    );
  const originals = new Map<Element, Element>();
  const copy = (original: Element): Element => {
    const clone = document.createElementNS(SVG_NS, original.localName);
    originals.set(clone, original);
    for (const attribute of original.attributes) {
      if (
        (original.localName === "pattern" && attribute.name === "overflow") ||
        attribute.name === "style" ||
        attribute.name === "class" ||
        attribute.name === "xmlns" ||
        attribute.name === "xmlns:xlink" ||
        (SVG_PRESENTATION_ATTRIBUTES.has(attribute.name) &&
          (!SVG_CSS_GEOMETRY.has(attribute.name) ||
            supportsCssGeometry(original, attribute.name))) ||
        attribute.name.startsWith("data-") ||
        attribute.name.startsWith("aria-")
      )
        continue;
      if (!SVG_ATTRIBUTES.has(attribute.name))
        throw new NativeSvgSourceError(
          "source-svg-attribute-unsupported",
          `SVG attribute ${attribute.name} needs a separate source path.`,
        );
      clone.setAttribute(attribute.name, attribute.value);
    }
    const style = getComputedStyle(original);
    if (
      typeof original.getAnimations === "function" &&
      original
        .getAnimations({ subtree: false })
        .some((animation) => animation.playState === "running")
    )
      throw new NativeSvgSourceError(
        "source-svg-animation-unsupported",
        "An animated SVG source cannot use a cached static raster.",
      );
    if (
      (style.filter && style.filter !== "none") ||
      [
        style.maskImage,
        style.getPropertyValue("-webkit-mask-image"),
        style.getPropertyValue("mask-border-source"),
        style.getPropertyValue("-webkit-mask-box-image-source"),
      ].some((value) => value && value !== "none") ||
      (style.mixBlendMode && style.mixBlendMode !== "normal") ||
      (style.backdropFilter && style.backdropFilter !== "none")
    )
      throw new NativeSvgSourceError(
        "source-svg-composite-unsupported",
        "An SVG source uses an unsupported paint compositor.",
      );
    if (
      !style.colorInterpolation ||
      !["auto", "srgb", "linearrgb"].includes(
        style.colorInterpolation.trim().toLowerCase(),
      )
    )
      throw new NativeSvgSourceError(
        "source-svg-color-interpolation-unsupported",
        "SVG color interpolation cannot be captured faithfully.",
      );
    if (["text", "tspan"].includes(original.localName))
      assertFontSupported(style);
    if (original.localName === "path") {
      const computedPath = style.getPropertyValue("d").trim();
      if (!computedPath && clone.hasAttribute("d"))
        throw new NativeSvgSourceError(
          "source-svg-path-style-unreadable",
          "An SVG path has no readable computed geometry.",
        );
      if (computedPath === "none") clone.removeAttribute("d");
      else if (computedPath) {
        const pathBody = /^path\(\s*(['"])([\s\S]*)\1\s*\)$/.exec(
          computedPath,
        )?.[2];
        if (
          !pathBody ||
          !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\-\s]+$/.test(pathBody) ||
          !/[Mm]/.test(pathBody)
        )
          throw new NativeSvgSourceError(
            "source-svg-path-style-unsupported",
            "An SVG path has unsupported computed geometry.",
          );
        clone.setAttribute("d", pathBody);
      }
    }
    for (const [name, key] of SVG_STYLES) {
      if (SVG_CSS_GEOMETRY.has(name)) {
        if (!supportsCssGeometry(original, name)) continue;
      }
      const value =
        paint && original === root && name === "opacity"
          ? "1"
          : original === root && name === "transform"
            ? "none"
            : (paint === "fill" && name === "stroke") ||
                (paint === "stroke" && name === "fill")
              ? "none"
              : name === "opacity"
                ? authoredSvgOpacity(original, style)
                : style[key];
      if (
        name === "transform" &&
        ["linearGradient", "radialGradient"].includes(original.localName)
      ) {
        if (value === "none") clone.removeAttribute("gradientTransform");
        else if (value)
          clone.setAttribute(
            "gradientTransform",
            localPaintReferences(value, ids),
          );
      } else if (value)
        clone.setAttribute(name, localPaintReferences(value, ids));
    }
    if (original.localName === "pattern")
      clone.setAttribute("overflow", "hidden");
    for (const child of original.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        clone.append(document.createTextNode(child.textContent ?? ""));
      } else if (child instanceof Element) {
        clone.append(copy(child));
      } else if (child.nodeType !== Node.COMMENT_NODE) {
        throw new NativeSvgSourceError(
          "source-svg-node-unsupported",
          "An SVG source contains an unsupported node.",
        );
      }
    }
    return clone;
  };
  const clone = copy(root);
  clone.setAttribute("overflow", rootStyle.overflowX);
  if (rootStyle.overflowX === "clip") {
    const visualBox =
      overflowClip.edge === "border"
        ? "border-box"
        : overflowClip.edge === "content"
          ? "content-box"
          : "padding-box";
    clone.setAttribute(
      "style",
      `overflow:clip;overflow-clip-margin:${visualBox} ${overflowClip.outset}px`,
    );
  }
  const graph = assertLocalResourceGraph(clone);
  assertPatternWorkBudget(root, clone, originals, graph, size, captureSize);
  clone.setAttribute("width", String(size.width));
  clone.setAttribute("height", String(size.height));
  const serialized = new XMLSerializer().serializeToString(clone);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SVG_SOURCE_BYTES)
    throw new NativeSvgSourceError(
      "source-svg-complex",
      "An SVG source exceeds the bounded serialization size.",
    );
  return serialized;
}

export async function rasterNativeSvgSource(
  source: SVGSVGElement,
  canvas: HTMLCanvasElement,
  density: number,
  paint?: "fill" | "stroke" | "coverage",
  size: { width: number; height: number } = source.getBoundingClientRect(),
): Promise<void> {
  const box = size;
  const overflow = classifyNativeComputedOverflowClip(getComputedStyle(source));
  if (!overflow.ok)
    throw new NativeSvgSourceError(
      `source-svg-${overflow.reason}`,
      overflow.detail,
    );
  if (overflow.edge === "none")
    throw new NativeSvgSourceError(
      "source-svg-overflow-unsupported",
      "An SVG root needs a bounded vector viewport clip.",
    );
  const capture = planNativeCaptureRoi({
    ownBox: { x: 0, y: 0, width: box.width, height: box.height },
    clipBox: {
      x: -overflow.outset,
      y: -overflow.outset,
      width: box.width + overflow.outset * 2,
      height: box.height + overflow.outset * 2,
    },
    density,
    maxDimension: MAX_SVG_SIDE,
    maxPixels: MAX_SVG_PIXELS,
  });
  if (!capture.ok)
    throw new NativeSvgSourceError(
      capture.reason === "capture-too-large"
        ? "source-svg-size"
        : "source-svg-capture-geometry-invalid",
      "An SVG source has invalid or oversized expanded capture geometry.",
    );
  const { width, height } = capture.plan.pixelBox;
  if (
    !Number.isFinite(density) ||
    density <= 0 ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_SVG_SIDE ||
    height > MAX_SVG_SIDE ||
    width * height > MAX_SVG_PIXELS
  )
    throw new NativeSvgSourceError(
      "source-svg-size",
      "An SVG source exceeds bounded physical raster dimensions.",
    );
  const serialized = serializeNativeSvgSource(
    source,
    {
      width: box.width,
      height: box.height,
    },
    {
      width: capture.plan.cssBox.width,
      height: capture.plan.cssBox.height,
    },
    paint,
  );
  const outer = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${capture.plan.cssBox.x} ${capture.plan.cssBox.y} ${capture.plan.cssBox.width} ${capture.plan.cssBox.height}">${serialized}</svg>`;
  await rasterSerializedNativeSvgSource(outer, canvas, capture.plan);
}

async function rasterSerializedNativeSvgSource(
  outer: string,
  canvas: HTMLCanvasElement,
  capture: NativeCaptureRoi,
): Promise<void> {
  const { width, height } = capture.pixelBox;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(outer)}`;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new NativeSvgSourceError(
                "source-svg-raster-timeout",
                "An SVG source did not finish rasterizing within 10 seconds.",
              ),
            ),
          10_000,
        );
      }),
    ]);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context)
      throw new NativeSvgSourceError(
        "source-svg-canvas-unavailable",
        "An SVG source has no 2D raster surface.",
      );
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    setNativeCaptureRoi(canvas, capture);
  } catch (error) {
    if (error instanceof NativeSvgSourceError) throw error;
    throw new NativeSvgSourceError(
      "source-svg-raster-failed",
      "The browser could not rasterize the SVG source.",
    );
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    image.src = "";
  }
}

export type NativeSvgGroupCoverageChild = {
  svg: SVGSVGElement;
  size: { width: number; height: number };
  localToGroup: NativeAffine2D;
};

export function serializeNativeSvgGroupSource(
  children: readonly NativeSvgGroupCoverageChild[],
  size: { width: number; height: number },
): string {
  if (
    !Object.values(size).every(
      (value) => Number.isFinite(value) && value > 0 && value <= MAX_SVG_SIDE,
    ) ||
    size.width * size.height > MAX_SVG_PIXELS ||
    children.reduce(
      (count, child) => count + child.svg.querySelectorAll("*").length + 1,
      0,
    ) > MAX_SVG_ELEMENTS
  )
    throw new NativeSvgSourceError(
      "source-svg-group-size",
      "An SVG vector group exceeds bounded capture dimensions.",
    );
  const ids = new Set<string>();
  const parts = children.map(({ svg, size: childSize, localToGroup }) => {
    if (Object.values(localToGroup).some((value) => !Number.isFinite(value)))
      throw new NativeSvgSourceError(
        "source-svg-transform-unsupported",
        "An SVG vector group has unreadable child geometry.",
      );
    for (const element of [svg, ...svg.querySelectorAll("[id]")]) {
      const id = element.getAttribute("id");
      if (!id) continue;
      if (ids.has(id))
        throw new NativeSvgSourceError(
          "source-svg-id-duplicate",
          "An SVG vector group has duplicate paint reference IDs.",
        );
      ids.add(id);
    }
    const opacity = authoredSvgOpacity(svg, getComputedStyle(svg));
    // Child viewports may overflow; the aggregate group supplies their bounded clip.
    const source = serializeNativeSvgSource(
      svg,
      childSize,
      childSize,
      "coverage",
      true,
    );
    const matrix = [
      localToGroup.a,
      localToGroup.b,
      localToGroup.c,
      localToGroup.d,
      localToGroup.e,
      localToGroup.f,
    ].join(" ");
    return `<g opacity="${opacity}" transform="matrix(${matrix})">${source}</g>`;
  });
  const markup = `<svg xmlns="${SVG_NS}" width="${size.width}" height="${size.height}" overflow="hidden">${parts.join("")}</svg>`;
  if (new TextEncoder().encode(markup).byteLength > MAX_SVG_SOURCE_BYTES)
    throw new NativeSvgSourceError(
      "source-svg-complex",
      "An SVG vector group exceeds the bounded serialization size.",
    );
  return markup;
}

export async function rasterNativeSvgGroupSource(
  children: readonly NativeSvgGroupCoverageChild[],
  canvas: HTMLCanvasElement,
  density: number,
  size: { width: number; height: number },
): Promise<void> {
  const box = { x: 0, y: 0, ...size };
  const capture = planNativeCaptureRoi({
    ownBox: box,
    clipBox: box,
    density,
    maxDimension: MAX_SVG_SIDE,
    maxPixels: MAX_SVG_PIXELS,
  });
  if (!capture.ok)
    throw new NativeSvgSourceError(
      "source-svg-group-size",
      "An SVG vector group exceeds bounded capture dimensions.",
    );
  const serialized = serializeNativeSvgGroupSource(children, size);
  const { width, height } = capture.plan.pixelBox;
  const outer = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${capture.plan.cssBox.width} ${capture.plan.cssBox.height}">${serialized}</svg>`;
  await rasterSerializedNativeSvgSource(outer, canvas, capture.plan);
}
