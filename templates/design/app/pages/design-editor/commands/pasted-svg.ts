const MAX_BYTES = 1_000_000;
const MAX_NODES = 10_000;
const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "use",
]);
const ALLOWED_ATTRIBUTES = new Set([
  "id",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "viewbox",
  "d",
  "points",
  "transform",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "preserveaspectratio",
  "xmlns",
  "href",
  "style",
]);
const ALLOWED_STYLE_PROPERTIES = new Set([
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "stop-color",
  "stop-opacity",
  "color",
  "display",
  "shape-rendering",
  "transform",
  "vector-effect",
  "visibility",
]);
const ELEMENT_NAMES: Record<string, string> = {
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  clippath: "clipPath",
};
const ATTRIBUTE_NAMES: Record<string, string> = {
  viewbox: "viewBox",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  preserveaspectratio: "preserveAspectRatio",
};

export interface PastedSvg {
  svg: string;
  width: number;
  height: number;
}

function numericDimension(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)(?:px)?\s*$/i.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 && number <= 100_000
    ? number
    : null;
}

function localReference(value: string): boolean {
  return !/url\((?!\s*['"]?#)/i.test(value);
}

function sanitizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) return "";
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const content = declaration.slice(colon + 1).trim();
      return ALLOWED_STYLE_PROPERTIES.has(name) && localReference(content)
        ? `${name}:${content}`
        : "";
    })
    .filter(Boolean)
    .join(";");
}

function sanitizeElement(
  element: Element,
  nodeCount: { value: number },
): boolean {
  nodeCount.value += 1;
  if (nodeCount.value > MAX_NODES) return false;
  const tag = element.localName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    element.remove();
    return true;
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (
      !ALLOWED_ATTRIBUTES.has(name) ||
      name.startsWith("on") ||
      (name === "href" && !value.startsWith("#")) ||
      (name !== "style" && !localReference(value))
    ) {
      element.removeAttribute(attribute.name);
    } else if (name === "style") {
      const safeStyle = sanitizeStyle(value);
      if (safeStyle) element.setAttribute("style", safeStyle);
      else element.removeAttribute("style");
    }
  }

  for (const child of Array.from(element.children)) {
    if (!sanitizeElement(child, nodeCount)) return false;
  }
  return true;
}

function hasDrawableGeometry(svg: Element): boolean {
  return Array.from(svg.children).some((element) => {
    const tag = element.localName.toLowerCase();
    if (tag === "g") return hasDrawableGeometry(element);
    if (
      tag === "defs" ||
      tag === "lineargradient" ||
      tag === "radialgradient" ||
      tag === "stop" ||
      tag === "clippath" ||
      tag === "mask"
    ) {
      return false;
    }
    if (tag === "path") return /[a-z]/i.test(element.getAttribute("d") ?? "");
    if (tag === "rect")
      return Boolean(
        numericDimension(element.getAttribute("width")) &&
        numericDimension(element.getAttribute("height")),
      );
    if (tag === "circle")
      return Boolean(numericDimension(element.getAttribute("r")));
    if (tag === "ellipse")
      return Boolean(
        numericDimension(element.getAttribute("rx")) &&
        numericDimension(element.getAttribute("ry")),
      );
    if (tag === "use")
      return element.getAttribute("href")?.startsWith("#") ?? false;
    return true;
  });
}

export function parsePastedSvg(source: string): PastedSvg | null {
  if (!source || new TextEncoder().encode(source).byteLength > MAX_BYTES)
    return null;
  const html = new DOMParser().parseFromString(source, "text/html");
  const roots = Array.from(html.querySelectorAll("svg"));
  if (roots.length !== 1) return null;
  const sourceSvg = roots[0];
  if (!sourceSvg) return null;
  const svgSource = /^\s*<svg\b/i.test(source)
    ? source.trim()
    : sourceSvg.outerHTML;
  const document = new DOMParser().parseFromString(svgSource, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror"))
    return null;
  const nodeCount = { value: 0 };
  if (!sanitizeElement(svg, nodeCount) || nodeCount.value > MAX_NODES)
    return null;
  if (!hasDrawableGeometry(svg)) return null;

  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxWidth =
    viewBox?.length === 4 &&
    Number.isFinite(viewBox[2]) &&
    viewBox[2]! > 0 &&
    viewBox[2]! <= 100_000
      ? viewBox[2]!
      : null;
  const viewBoxHeight =
    viewBox?.length === 4 &&
    Number.isFinite(viewBox[3]) &&
    viewBox[3]! > 0 &&
    viewBox[3]! <= 100_000
      ? viewBox[3]!
      : null;
  let width = numericDimension(svg.getAttribute("width"));
  let height = numericDimension(svg.getAttribute("height"));
  if (!width && height && viewBoxWidth && viewBoxHeight)
    width = (height * viewBoxWidth) / viewBoxHeight;
  if (!height && width && viewBoxWidth && viewBoxHeight)
    height = (width * viewBoxHeight) / viewBoxWidth;
  width ??= viewBoxWidth;
  height ??= viewBoxHeight;
  if (!width || !height || width > 100_000 || height > 100_000) return null;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return { svg: svg.outerHTML, width, height };
}
