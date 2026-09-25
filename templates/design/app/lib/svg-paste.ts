import postcss from "postcss";

const SHAPE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);
const GROUP_TAGS = new Set(["g", "a", "switch"]);
const SHAPE_GEOMETRY_ATTRIBUTES = [
  "d",
  "x",
  "y",
  "width",
  "height",
  "rx",
  "ry",
  "cx",
  "cy",
  "r",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "pathLength",
  "clip-path",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
];
/** Computed paint written back as attributes, with the value that is the SVG
 * initial value and therefore not worth persisting. */
const PAINT_PROPERTIES: Array<[string, string | null]> = [
  ["fill", null],
  ["fill-opacity", "1"],
  ["fill-rule", "nonzero"],
  ["stroke", "none"],
  ["stroke-width", "1"],
  ["stroke-opacity", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-miterlimit", "4"],
  ["stroke-dasharray", "none"],
  ["stroke-dashoffset", "0"],
  ["clip-rule", "nonzero"],
];
const UNSAFE_TAGS = new Set(
  [
    "script",
    "foreignObject",
    "iframe",
    "object",
    "embed",
    "animate",
    "animateMotion",
    "animateTransform",
    "set",
    "discard",
  ].map((tag) => tag.toLowerCase()),
);
const UNSUPPORTED_TAGS = new Set(["image", "text", "use", "foreignobject"]);
/** Elements a Vector may carry in its own `<defs>`; anything else is dropped. */
const DEF_TAGS = new Set(
  [
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "g",
    ...SHAPE_TAGS,
  ].map((tag) => tag.toLowerCase()),
);
const GROUP_EFFECT_ATTRIBUTES = ["clip-path", "mask", "filter"];
const LOCAL_REFERENCE = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/gi;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function removeCssLineContinuations(value: string): string {
  return value.replace(/\\(?:\r\n|[\n\r\f])/g, "");
}

function normalizeCssTokens(value: string): string {
  const uncommented = value.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineContinuations = removeCssLineContinuations(uncommented);
  return withoutLineContinuations.replace(
    /\\([\da-f]{1,6})(?:\r\n|\s)?|\\(.)/gi,
    (_, hex, escaped) => {
      if (!hex) return escaped;
      const codePoint = Number.parseInt(hex, 16);
      return String.fromCodePoint(
        codePoint > 0x10ffff || codePoint === 0 ? 0xfffd : codePoint,
      );
    },
  );
}

function sanitizeExternalUrlReferences(value: string): string {
  const normalized = normalizeCssTokens(value);
  if (!/url\s*\(/i.test(normalized)) return value;
  return normalized.replace(
    /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (reference, doubleQuoted, singleQuoted, unquoted) => {
      const target = (doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
      return target.startsWith("#") ? reference : "";
    },
  );
}

function sanitizeStyleAttribute(value: string): string | null {
  try {
    const root = postcss.parse(`svg{${removeCssLineContinuations(value)}}`);
    root.walkDecls((declaration) => {
      declaration.value = sanitizeExternalUrlReferences(declaration.value);
    });
    const rule = root.first;
    const style = document.createElement("div").style;
    style.cssText =
      rule?.type === "rule"
        ? rule.nodes.map((node) => node.toString()).join(";")
        : "";
    return style.length ? style.cssText : null;
    // coercion-ok: malformed SVG style declarations are dropped at the paste boundary.
  } catch {
    return null;
  }
}

function sanitizeStyleSheet(styleElement: Element): void {
  try {
    const root = postcss.parse(
      removeCssLineContinuations(styleElement.textContent ?? ""),
    );
    root.walkAtRules((rule) => {
      if (normalizeCssTokens(rule.name).toLowerCase() === "import") {
        rule.remove();
      }
    });
    root.walkDecls((declaration) => {
      declaration.value = sanitizeExternalUrlReferences(declaration.value);
    });
    styleElement.textContent = root.toString();
  } catch {
    styleElement.remove();
  }
}
/** Past these, a pasted SVG is artwork rather than an icon or logo and goes
 * through the image upload instead of into the document as markup. */
const MAX_SVG_MARKUP_LENGTH = 512 * 1024;
const MAX_VECTOR_LAYERS = 400;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgShapeMeasurement {
  /** Box in CSS px, relative to the SVG's top-left at its natural size. */
  box: Rect;
  /** The same box in the root SVG's user units (its viewBox space). */
  userBox: Rect;
  paint: Record<string, string>;
  opacity: number;
  transform: string;
}

export interface PastedSvgLayer {
  html: string;
  width: number;
  height: number;
}

type MeasureSvg = (
  root: SVGSVGElement,
  size: { width: number; height: number },
) => Map<Element, SvgShapeMeasurement | null>;

/** Returns the `<svg>` markup when clipboard text is an SVG document. */
export function extractSvgMarkup(text: string): string | null {
  const body = text
    .replace(/^﻿/, "")
    .trim()
    .replace(/^(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s)+/i, "");
  if (!/^<svg[\s>]/i.test(body) || !/<\/svg>$/i.test(body)) return null;
  return body;
}

export function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

export function svgLayerName(fileName: string): string {
  return fileName.replace(/\.svg$/i, "").trim() || "Frame";
}

function parseSvgRoot(markup: string): SVGSVGElement | null {
  // XML normalizes attribute line breaks before the CSS sanitizer sees them.
  const sanitizedMarkup = markup.replace(
    /<(?:"[^"]*"|'[^']*'|[^'">])*?>/g,
    removeCssLineContinuations,
  );
  const namespacedMarkup = sanitizedMarkup.replace(
    /<(svg)(?=[\s>])((?:"[^"]*"|'[^']*'|[^'">])*)>/i,
    (_tag, rootName: string, attributes: string) => {
      const namespace = /\sxmlns\s*=\s*(["'])[\s\S]*?\1/i;
      const namespacedAttributes = namespace.test(attributes)
        ? attributes.replace(namespace, ` xmlns="${SVG_NAMESPACE}"`)
        : `${attributes} xmlns="${SVG_NAMESPACE}"`;
      return `<${rootName}${namespacedAttributes}>`;
    },
  );
  const doc = new DOMParser().parseFromString(
    namespacedMarkup,
    "image/svg+xml",
  );
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName.toLowerCase() !== "svg"
  ) {
    return null;
  }
  return doc.documentElement as unknown as SVGSVGElement;
}

function svgElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function sanitizeSvg(root: SVGSVGElement): void {
  for (const element of svgElements(root)) {
    if (UNSAFE_TAGS.has(element.localName.toLowerCase())) element.remove();
  }
  for (const element of svgElements(root)) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name.startsWith("data-an-") ||
        name.startsWith("data-agent-native-")
      ) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === "href" || name === "xlink:href") &&
        value !== "" &&
        !value.startsWith("#")
      ) {
        element.removeAttribute(attribute.name);
      } else if (name === "style") {
        const safeStyle = sanitizeStyleAttribute(value);
        if (safeStyle) element.setAttribute(attribute.name, safeStyle);
        else element.removeAttribute(attribute.name);
      } else if (/javascript:|data:text\/html/i.test(value)) {
        element.removeAttribute(attribute.name);
      } else {
        const safeValue = sanitizeExternalUrlReferences(value);
        if (safeValue !== value) {
          if (safeValue) element.setAttribute(attribute.name, safeValue);
          else element.removeAttribute(attribute.name);
        }
      }
    }
  }
  for (const element of svgElements(root)) {
    if (element.localName.toLowerCase() === "style") {
      sanitizeStyleSheet(element);
    }
  }
}

function lengthAttribute(value: string | null): number | null {
  if (!value || !/^\s*[\d.]+(?:px)?\s*$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return parsed > 0 ? parsed : null;
}

function viewBoxOf(root: SVGSVGElement): Rect | null {
  const parts = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** The size the SVG declares for itself: width/height, else its viewBox. */
export function svgNaturalSize(root: SVGSVGElement): {
  width: number;
  height: number;
} {
  const viewBox = viewBoxOf(root);
  const width = lengthAttribute(root.getAttribute("width"));
  const height = lengthAttribute(root.getAttribute("height"));
  const ratio = viewBox ? viewBox.width / viewBox.height : 2;
  if (width && height) return { width, height };
  if (width) return { width, height: width / ratio };
  if (height) return { width: height * ratio, height };
  if (viewBox) return { width: viewBox.width, height: viewBox.height };
  return { width: 300, height: 150 };
}

/** Shapes that render as layers: not inside defs, clipPath, mask, symbol… */
function drawableShapes(root: SVGSVGElement): Element[] {
  const shapes: Element[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (SHAPE_TAGS.has(tag)) shapes.push(child);
      else if (GROUP_TAGS.has(tag)) walk(child);
    }
  };
  walk(root);
  return shapes;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function localReferences(element: Element): string[] {
  const ids: string[] = [];
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (
      (name === "href" || name === "xlink:href") &&
      attribute.value.startsWith("#")
    ) {
      ids.push(attribute.value.slice(1));
    }
    for (const match of attribute.value.matchAll(LOCAL_REFERENCE))
      ids.push(match[1]!);
  }
  return ids;
}

/**
 * Copies of every paint server, clip, mask, and filter the given ids reach,
 * wherever they sit in the source, with ids prefixed so two pastes of icons
 * sharing short ids (`a`, `clip0`) never resolve to each other. Null means a
 * reference needs an element outside the allowlist.
 */
function defsFor(
  root: SVGSVGElement,
  ids: string[],
  prefix: string,
): { defs: string; ids: Set<string> } | null {
  const byId = new Map(
    Array.from(root.querySelectorAll("[id]")).map((element) => [
      element.id,
      element,
    ]),
  );
  const pending = [...ids];
  const copied = new Map<string, Element>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (copied.has(id)) continue;
    const source = byId.get(id);
    if (!source) continue;
    const clone = source.cloneNode(true) as Element;
    for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      if (!DEF_TAGS.has(element.tagName.toLowerCase())) return null;
      for (const attribute of Array.from(element.attributes)) {
        const value = attribute.value;
        if (
          /url\(/i.test(value) &&
          value.replace(LOCAL_REFERENCE, "").match(/url\(/i)
        ) {
          element.removeAttribute(attribute.name);
        }
      }
      pending.push(...localReferences(element));
    }
    copied.set(id, clone);
  }
  const copiedIds = new Set(copied.keys());
  if (copied.size === 0) return { defs: "", ids: copiedIds };
  const markup = Array.from(copied.values())
    .map((clone) => {
      for (const element of [
        clone,
        ...Array.from(clone.querySelectorAll("[id]")),
      ]) {
        if (element.id) element.id = `${prefix}${element.id}`;
      }
      return clone.outerHTML;
    })
    .join("");
  return {
    defs: `<defs>${prefixReferences(markup, prefix, copiedIds)}</defs>`,
    ids: copiedIds,
  };
}

function prefixReferences(
  markup: string,
  prefix: string,
  ids: Set<string>,
): string {
  return markup
    .replace(
      /url\(\s*(?:&quot;|["'])?#([^"'&)\s]+)(?:&quot;|["'])?\s*\)/g,
      (all, id) => (ids.has(id) ? `url(#${prefix}${id})` : all),
    )
    .replace(/(href=")#([^"]+)"/g, (all, head, id) =>
      ids.has(id) ? `${head}#${prefix}${id}"` : all,
    );
}

/**
 * Measures each shape by rendering the SVG, detached from the editor's styles
 * inside a shadow root, at its natural size. `getScreenCTM` maps client boxes
 * back to user units, which also covers viewBox letterboxing.
 */
export const measureSvgInDocument: MeasureSvg = (root, size) => {
  const host = document.createElement("div");
  host.style.cssText =
    // guard:allow-raw-color — offscreen measuring host; currentColor must resolve to a paint
    "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;color:#000";
  const shadow = host.attachShadow({ mode: "closed" });
  const mounted = document.importNode(root, true);
  mounted.setAttribute("width", String(size.width));
  mounted.setAttribute("height", String(size.height));
  // guard:allow-raw-color — same offscreen measurement as the host above
  mounted.style.cssText = "display:block;color:#000";
  shadow.append(mounted);
  document.body.append(host);
  const results = new Map<Element, SvgShapeMeasurement | null>();
  try {
    const rootRect = mounted.getBoundingClientRect();
    const toUser = mounted.getScreenCTM()?.inverse();
    // Stops styled by a <style> class lose their colour once <style> is gone.
    const sourceStops = svgElements(root).filter(
      (element) => element.localName.toLowerCase() === "stop",
    );
    svgElements(mounted)
      .filter((element) => element.localName.toLowerCase() === "stop")
      .forEach((stop, index) => {
        const computed = getComputedStyle(stop);
        sourceStops[index]?.setAttribute("stop-color", computed.stopColor);
        sourceStops[index]?.setAttribute("stop-opacity", computed.stopOpacity);
      });
    const originals = drawableShapes(root);
    drawableShapes(mounted).forEach((shape, index) => {
      const original = originals[index]!;
      const computed = getComputedStyle(shape);
      const rect = shape.getBoundingClientRect();
      if (!toUser || computed.display === "none") {
        results.set(original, null);
        return;
      }
      const topLeft = new DOMPoint(rect.left, rect.top).matrixTransform(toUser);
      const bottomRight = new DOMPoint(rect.right, rect.bottom).matrixTransform(
        toUser,
      );
      const paint: Record<string, string> = {};
      for (const [property] of PAINT_PROPERTIES) {
        paint[property] = computed.getPropertyValue(property).trim();
      }
      let opacity = Number(computed.opacity) || 0;
      const transforms: string[] = [];
      for (
        let node: Element | null = shape;
        node && node !== mounted;
        node = node.parentElement
      ) {
        if (node !== shape) opacity *= Number(getComputedStyle(node).opacity);
        const transform = node.getAttribute("transform");
        if (transform) transforms.unshift(transform);
      }
      results.set(original, {
        box: {
          x: rect.left - rootRect.left,
          y: rect.top - rootRect.top,
          width: rect.width,
          height: rect.height,
        },
        userBox: {
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        },
        paint,
        opacity,
        transform: transforms.join(" "),
      });
    });
  } finally {
    host.remove();
  }
  return results;
};

function paintAttributes(paint: Record<string, string>): string {
  const invisibleStroke = !paint.stroke || paint.stroke === "none";
  return PAINT_PROPERTIES.map(([property, initial]) => {
    let value = paint[property];
    if (!value || value === initial) return "";
    if (property.startsWith("stroke-") && invisibleStroke) return "";
    if (property === "stroke-width" || property === "stroke-dashoffset") {
      value = value.replace(/px$/, "");
    }
    return ` ${property}="${escapeAttribute(value)}"`;
  }).join("");
}

function isInvisible(paint: Record<string, string>): boolean {
  return (
    (paint.fill === "none" || !paint.fill) &&
    (paint.stroke === "none" || !paint.stroke)
  );
}

/** A zero-width or zero-height box (a straight line) cannot carry a viewBox. */
function atLeastOnePixel(box: Rect, userBox: Rect): [Rect, Rect] {
  const grow = (start: number, extent: number): [number, number] =>
    extent >= 1 ? [start, extent] : [start - (1 - extent) / 2, 1];
  const scaleX = box.width > 0 ? userBox.width / box.width : 1;
  const scaleY = box.height > 0 ? userBox.height / box.height : 1;
  const [x, width] = grow(box.x, box.width);
  const [y, height] = grow(box.y, box.height);
  return [
    { x, y, width, height },
    {
      x: userBox.x - (box.x - x) * scaleX,
      y: userBox.y - (box.y - y) * scaleY,
      width: width * scaleX,
      height: height * scaleY,
    },
  ];
}

/**
 * A frame of Vector layers, one path primitive per shape, as Figma imports an
 * SVG. Null means upload it as an image instead (rasters, text, huge artwork).
 */
export function buildPastedSvgLayer(
  markup: string,
  name: string,
  measure: MeasureSvg = measureSvgInDocument,
): PastedSvgLayer | null {
  if (markup.length > MAX_SVG_MARKUP_LENGTH) return null;
  const root = parseSvgRoot(markup);
  if (
    !root ||
    svgElements(root).some((element) =>
      UNSUPPORTED_TAGS.has(element.localName.toLowerCase()),
    )
  ) {
    return null;
  }
  sanitizeSvg(root);
  const size = svgNaturalSize(root);
  const shapes = drawableShapes(root);
  if (shapes.length === 0 || shapes.length > MAX_VECTOR_LAYERS) return null;
  const measurements = measure(root, size);
  let unsupported = false;
  const vectors = shapes.flatMap((shape) => {
    const measured = measurements.get(shape);
    if (!measured || isInvisible(measured.paint)) return [];
    const [box, userBox] = atLeastOnePixel(measured.box, measured.userBox);
    const tag = shape.tagName.toLowerCase();
    const geometry = SHAPE_GEOMETRY_ATTRIBUTES.map((attribute) => {
      const value = shape.getAttribute(attribute);
      return value === null ? "" : ` ${attribute}="${escapeAttribute(value)}"`;
    }).join("");
    const ancestors: Element[] = [];
    for (
      let node = shape.parentElement;
      node && node !== (root as Element);
      node = node.parentElement
    ) {
      ancestors.unshift(node);
    }
    // A group clip, mask, or filter applies in that group's own space, so
    // those groups are kept as wrappers instead of flattened into the shape.
    const keepGroups = ancestors.some((ancestor) =>
      GROUP_EFFECT_ATTRIBUTES.some((name) => ancestor.hasAttribute(name)),
    );
    const groupAttributes = (element: Element) =>
      ["transform", "opacity", ...GROUP_EFFECT_ATTRIBUTES]
        .map((name) => {
          const value = element.getAttribute(name);
          return value === null ? "" : ` ${name}="${escapeAttribute(value)}"`;
        })
        .join("");
    const ownTransform = keepGroups
      ? shape.getAttribute("transform")
      : measured.transform;
    const transform = ownTransform
      ? ` transform="${escapeAttribute(ownTransform)}"`
      : "";
    const opacity =
      !keepGroups && measured.opacity < 1
        ? ` opacity="${round(measured.opacity)}"`
        : "";
    const shapeMarkup = `<${tag}${geometry}${transform}${paintAttributes(measured.paint)}${opacity}></${tag}>`;
    const content = keepGroups
      ? `${ancestors.map((ancestor) => `<g${groupAttributes(ancestor)}>`).join("")}${shapeMarkup}${"</g>".repeat(ancestors.length)}`
      : shapeMarkup;
    const references = [
      ...localReferences(shape),
      ...Object.values(measured.paint).flatMap((value) =>
        Array.from(value.matchAll(LOCAL_REFERENCE), (match) => match[1]!),
      ),
      ...(keepGroups ? ancestors.flatMap(localReferences) : []),
    ];
    const prefix = `${uniqueId("v").slice(0, 10)}-`;
    const owned = defsFor(root, references, prefix);
    if (owned === null) {
      unsupported = true;
      return [];
    }
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="${uniqueId("vector")}" data-agent-native-layer-name="Vector" data-an-primitive="path" viewBox="${round(userBox.x)} ${round(userBox.y)} ${round(userBox.width)} ${round(userBox.height)}" preserveAspectRatio="none" style="position:absolute;left:${round(box.x)}px;top:${round(box.y)}px;width:${round(box.width)}px;height:${round(box.height)}px;overflow:visible">${owned.defs}${prefixReferences(content, prefix, owned.ids)}</svg>`,
    ];
  });
  if (unsupported) return null;
  if (vectors.length === 0) return null;
  const width = round(size.width);
  const height = round(size.height);
  return {
    html: `<div data-agent-native-node-id="${uniqueId("pasted-svg")}" data-agent-native-layer-name="${escapeAttribute(name)}" data-an-primitive="frame" style="position:absolute;width:${width}px;height:${height}px">${vectors.join("")}</div>`,
    width,
    height,
  };
}
