import { XMLParser, XMLValidator } from "fast-xml-parser";

const ELEMENTS = new Set([
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
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
]);
const ATTRIBUTES = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
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
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "clip-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
  "id",
  "gradientUnits",
  "gradientTransform",
  "offset",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "preserveAspectRatio",
]);
const COLOR =
  /^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]+|url\(#[A-Za-z][\w.-]*\))$/;
const NUMERIC = /^[\d\s.,+\-eE%]*$/;
const PATH = /^[\d\s.,+\-eEa-zA-Z]*$/;
const TRANSFORM =
  /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([\d\s.,+\-eE]+\)\s*)+$/;

interface XmlNode {
  [key: string]: XmlNode[] | string | Record<string, string>;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function safeAttribute(name: string, value: string): boolean {
  if (!ATTRIBUTES.has(name) || value.length > 100_000) return false;
  if (name === "xmlns") return value === "http://www.w3.org/2000/svg";
  if (name === "id") return /^[A-Za-z][\w.-]*$/.test(value);
  if (["fill", "stroke", "stop-color"].includes(name)) return COLOR.test(value);
  if (name === "clip-path") return /^url\(#[A-Za-z][\w.-]*\)$/.test(value);
  if (name === "transform" || name === "gradientTransform")
    return TRANSFORM.test(value);
  if (
    [
      "stroke-linecap",
      "stroke-linejoin",
      "fill-rule",
      "clip-rule",
      "gradientUnits",
      "preserveAspectRatio",
    ].includes(name)
  ) {
    return /^[A-Za-z\s]+$/.test(value);
  }
  if (name === "d") return PATH.test(value);
  return NUMERIC.test(value);
}

function serializeNode(node: XmlNode): string {
  const entries = Object.entries(node).filter(([name]) => name !== ":@");
  if (entries.length !== 1) throw new Error("SVG contains unsupported markup");
  const [name, children] = entries[0]!;
  if (!ELEMENTS.has(name) || !Array.isArray(children)) {
    throw new Error("SVG contains unsupported markup");
  }
  const attributes = (node[":@"] ?? {}) as Record<string, string>;
  let opening = `<${name}`;
  for (const [rawName, value] of Object.entries(attributes)) {
    const attribute = rawName.startsWith("@_") ? rawName.slice(2) : rawName;
    if (typeof value !== "string" || !safeAttribute(attribute, value)) {
      throw new Error("SVG contains an unsafe attribute");
    }
    opening += ` ${attribute}="${escapeAttribute(value)}"`;
  }
  const body = children
    .map((child) => {
      if ("#text" in child) {
        if (typeof child["#text"] !== "string" || child["#text"].trim()) {
          throw new Error("SVG contains unsupported text");
        }
        return "";
      }
      return serializeNode(child);
    })
    .join("");
  return `${opening}>${body}</${name}>`;
}

/** Canonicalize the small SVG icon vocabulary before bytes reach storage. */
export function sanitizeIconSvg(data: Uint8Array): Uint8Array {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(data).trim();
  if (!source.startsWith("<svg") || /<!|<\?/.test(source)) {
    throw new Error("Invalid SVG icon");
  }
  if (XMLValidator.validate(source) !== true)
    throw new Error("Invalid SVG icon");
  const nodes = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: true,
    processEntities: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  }).parse(source) as XmlNode[];
  if (nodes.length !== 1 || !Object.hasOwn(nodes[0]!, "svg")) {
    throw new Error("Invalid SVG icon");
  }
  return new TextEncoder().encode(serializeNode(nodes[0]!));
}
