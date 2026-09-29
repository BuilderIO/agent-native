import { serializePenNodes } from "@shared/pen-path";
import { parseSvgPathData } from "@shared/svg-path-data";

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
  "height",
  "shape-rendering",
  "transform",
  "vector-effect",
  "visibility",
  "width",
]);
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

function validViewBoxDimension(value: number): boolean {
  return Number.isFinite(value) && value <= 100_000 && value > 0;
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|([\r\n\f]|[^\r\n\f]))/gi,
    (_escape, hex: string | undefined, character: string | undefined) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        return codePoint === 0 || codePoint > 0x10ffff
          ? "\ufffd"
          : String.fromCodePoint(codePoint);
      }
      return character && !/[\r\n\f]/.test(character) ? character : "";
    },
  );
}

function normalizeCssValue(value: string): string {
  return decodeCssEscapes(value).replace(/\/\*[\s\S]*?\*\//g, "");
}

function localReference(value: string): boolean {
  return !/url\((?!\s*['"]?#)/i.test(normalizeCssValue(value));
}

function sanitizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) return "";
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const content = normalizeCssValue(declaration.slice(colon + 1).trim());
      return ALLOWED_STYLE_PROPERTIES.has(name) && localReference(content)
        ? `${name}:${content}`
        : "";
    })
    .filter(Boolean)
    .join(";");
}

function hasInlineTransform(element: Element | undefined): boolean {
  return (element?.getAttribute("style") ?? "")
    .split(";")
    .some((declaration) => {
      const separator = declaration.indexOf(":");
      return (
        separator >= 0 &&
        declaration.slice(0, separator).trim().toLowerCase() === "transform"
      );
    });
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
    } else if (["fill", "stroke", "clip-path", "mask"].includes(name)) {
      element.setAttribute(attribute.name, normalizeCssValue(value));
    }
  }

  for (const child of Array.from(element.children)) {
    if (!sanitizeElement(child, nodeCount)) return false;
  }
  return true;
}

function inlineDimension(element: Element, property: "width" | "height") {
  const declarations = element.getAttribute("style")?.split(";") ?? [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    if (declaration.slice(0, separator).trim().toLowerCase() !== property) {
      continue;
    }
    return numericDimension(declaration.slice(separator + 1).trim());
  }
  return null;
}

let pastedSvgScopeSequence = 0;

function scopeSvgIds(svg: Element): void {
  const scope =
    globalThis.crypto?.randomUUID?.() ??
    "design-" +
      Date.now().toString(36) +
      "-" +
      (++pastedSvgScopeSequence).toString(36);
  const idMap = new Map<string, string>();
  const elements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const scopedId = "an-pasted-" + scope + "-" + id;
    idMap.set(id, scopedId);
    element.setAttribute("id", scopedId);
  }
  if (idMap.size === 0) return;

  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") continue;
      if (attribute.name === "href" && attribute.value.startsWith("#")) {
        const target = idMap.get(attribute.value.slice(1));
        if (target) element.setAttribute(attribute.name, "#" + target);
        continue;
      }
      const rewritten = attribute.value.replace(
        /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/gi,
        (reference, quote: string, id: string) => {
          const target = idMap.get(id);
          return target
            ? "url(" + quote + "#" + target + quote + ")"
            : reference;
        },
      );
      if (rewritten !== attribute.value) {
        element.setAttribute(attribute.name, rewritten);
      }
    }
  }
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
  if (
    svg.localName.toLowerCase() !== "svg" ||
    document.querySelector("parsererror")
  )
    return null;
  const nodeCount = { value: 0 };
  if (!sanitizeElement(svg, nodeCount) || nodeCount.value > MAX_NODES)
    return null;
  scopeSvgIds(svg);
  if (!hasDrawableGeometry(svg)) return null;

  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxWidthValue = Number(viewBox?.[2]);
  const viewBoxHeightValue = Number(viewBox?.[3]);
  const viewBoxWidth =
    viewBox?.length === 4 && validViewBoxDimension(viewBoxWidthValue)
      ? viewBoxWidthValue
      : null;
  const viewBoxHeight =
    viewBox?.length === 4 && validViewBoxDimension(viewBoxHeightValue)
      ? viewBoxHeightValue
      : null;
  let width =
    inlineDimension(svg, "width") ??
    numericDimension(svg.getAttribute("width"));
  let height =
    inlineDimension(svg, "height") ??
    numericDimension(svg.getAttribute("height"));
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
  const viewBoxValues =
    svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  const elements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const directPenCoordinates =
    viewBoxValues.length === 4 &&
    viewBoxValues.every(Number.isFinite) &&
    Math.abs(viewBoxValues[0]!) < 0.001 &&
    Math.abs(viewBoxValues[1]!) < 0.001 &&
    Math.abs(viewBoxValues[2]! - width) < 0.001 &&
    Math.abs(viewBoxValues[3]! - height) < 0.001 &&
    elements.every(
      (element) =>
        !element.hasAttribute("transform") && !hasInlineTransform(element),
    );
  if (directPenCoordinates) {
    const paths = Array.from(svg.querySelectorAll("path")).filter((path) => {
      let ancestor = path.parentElement;
      while (ancestor && ancestor !== svg) {
        if (
          ["defs", "clippath", "mask"].includes(
            ancestor.localName.toLowerCase(),
          )
        )
          return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
    const editablePaths = paths.flatMap((path) => {
      const pathData = path.getAttribute("d") ?? "";
      const unparsedPathSyntax = pathData
        .replace(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi, "")
        .replace(/[\s,]/g, "");
      if (unparsedPathSyntax) return [];
      const parsedPaths = parseSvgPathData(pathData);
      const penPath = parsedPaths?.length === 1 ? parsedPaths[0] : null;
      return penPath && penPath.nodes.length > 1 ? [{ path, penPath }] : [];
    });
    if (
      paths.length === 1 &&
      svg.children.length === 1 &&
      svg.firstElementChild === paths[0]
    ) {
      const editablePath = editablePaths[0];
      if (editablePath) {
        svg.setAttribute(
          "data-an-pen-nodes",
          serializePenNodes(editablePath.penPath),
        );
      }
    } else {
      for (const { path, penPath } of editablePaths) {
        path.setAttribute("data-an-pen-nodes", serializePenNodes(penPath));
      }
    }
  }
  return { svg: svg.outerHTML, width, height };
}
