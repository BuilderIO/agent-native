import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import postcss from "postcss";

const INERT_SNAPSHOT_TAGS = new Set([
  "animate",
  "applet",
  "audio",
  "base",
  "embed",
  "foreignobject",
  "form",
  "frame",
  "iframe",
  "link",
  "meta",
  "noscript",
  "object",
  "portal",
  "script",
  "set",
  "source",
  "style",
  "template",
  "track",
  "video",
  "datalist",
  "input",
  "keygen",
  "meter",
  "optgroup",
  "option",
  "output",
  "progress",
  "select",
  "textarea",
]);

const NON_RESOURCE_URL_ATTRIBUTES = new Set([
  "action",
  "archive",
  "attributionsrc",
  "cite",
  "classid",
  "code",
  "codebase",
  "data",
  "dynsrc",
  "formaction",
  "href",
  "icon",
  "imagesizes",
  "imagesrcset",
  "itemid",
  "longdesc",
  "lowsrc",
  "manifest",
  "ping",
  "profile",
  "srcdoc",
  "srcset",
  "target",
  "usemap",
  "xlink:href",
  "xml:base",
]);

const SAFE_RESOURCE_URL_ATTRIBUTES = new Set(["background", "poster", "src"]);
const URL_BEARING_PRESENTATION_ATTRIBUTES = new Set([
  "background-image",
  "border-image-source",
  "clip-path",
  "color-profile",
  "content",
  "cursor",
  "fill",
  "filter",
  "list-style-image",
  "marker",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "mask-border-source",
  "mask-image",
  "offset-path",
  "shape-outside",
  "stroke",
]);
const RESOURCE_FUNCTIONS = new Set([
  "image",
  "image-set",
  "url",
  "-webkit-image-set",
]);

function isSafeSnapshotResourceUrl(value: string): boolean {
  const normalized = value.trim();
  // A remote viewer's browser resolves these URLs later, so publish-time DNS
  // checks cannot prevent a hostname from rebinding to a private address.
  return /^data:image\//i.test(normalized);
}

function isSafeCssResourceUrl(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("#") || isSafeSnapshotResourceUrl(normalized);
}

function consumeCssEscape(value: string, start: number): [string, number] {
  let index = start + 1;
  if (index >= value.length) return ["�", index];

  if (/[\da-f]/i.test(value[index]!)) {
    const hexStart = index;
    while (
      index < value.length &&
      index - hexStart < 6 &&
      /[\da-f]/i.test(value[index]!)
    ) {
      index += 1;
    }
    const codePoint = Number.parseInt(value.slice(hexStart, index), 16);
    if (index < value.length && /[\t\n\f\r ]/.test(value[index]!)) {
      if (value[index] === "\r" && value[index + 1] === "\n") index += 2;
      else index += 1;
    }
    return [
      codePoint === 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? "�"
        : String.fromCodePoint(codePoint),
      index,
    ];
  }

  if (value[index] === "\r" && value[index + 1] === "\n")
    return ["", index + 2];
  if (/[\n\r\f]/.test(value[index]!)) return ["", index + 1];
  return [value[index]!, index + 1];
}

function decodeCssEscapes(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; ) {
    if (value[index] === "\\") {
      const [character, next] = consumeCssEscape(value, index);
      decoded += character;
      index = next;
    } else {
      decoded += value[index];
      index += 1;
    }
  }
  return decoded;
}

function skipCssString(value: string, start: number): number {
  const quote = value[start];
  for (let index = start + 1; index < value.length; ) {
    if (value[index] === "\\") {
      [, index] = consumeCssEscape(value, index);
    } else if (value[index] === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return value.length;
}

function skipCssComment(value: string, start: number): number {
  const end = value.indexOf("*/", start + 2);
  return end === -1 ? value.length : end + 2;
}

function skipCssWhitespaceAndComments(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    if (/\s/.test(value[index]!)) index += 1;
    else if (value.startsWith("/*", index))
      index = skipCssComment(value, index);
    else break;
  }
  return index;
}

function findCssFunctionEnd(value: string, openParen: number): number {
  let depth = 1;
  for (let index = openParen + 1; index < value.length; ) {
    if (value.startsWith("/*", index)) index = skipCssComment(value, index);
    else if (value[index] === "'" || value[index] === '"') {
      index = skipCssString(value, index);
    } else if (value[index] === "\\") {
      [, index] = consumeCssEscape(value, index);
    } else if (value[index] === "(") {
      depth += 1;
      index += 1;
    } else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
      index += 1;
    } else {
      index += 1;
    }
  }
  return -1;
}

function readCssString(value: string): [string, number] | null {
  const quote = value[0];
  if (quote !== "'" && quote !== '"') return null;
  let contents = "";
  for (let index = 1; index < value.length; ) {
    if (value[index] === "\\") {
      const [character, next] = consumeCssEscape(value, index);
      contents += character;
      index = next;
    } else if (value[index] === quote) {
      return [contents, index + 1];
    } else {
      contents += value[index];
      index += 1;
    }
  }
  return null;
}

function hasUnsafeImageSetString(value: string): boolean {
  for (const candidate of splitTopLevelCssCommas(value)) {
    const start = skipCssWhitespaceAndComments(candidate, 0);
    if (candidate[start] === "'" || candidate[start] === '"') {
      const parsed = readCssString(candidate.slice(start));
      if (!parsed || !isSafeCssResourceUrl(parsed[0])) return true;
      continue;
    }
    const source = decodeCssEscapes(candidate.slice(start).trim())
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .toLowerCase();
    if (/^(?:var|env|attr)\s*\(/.test(source)) return true;
  }
  return false;
}

function hasUnsafeCssResource(value: string): boolean {
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("/*", index)) {
      index = skipCssComment(value, index);
      continue;
    }
    if (value[index] === "'" || value[index] === '"') {
      index = skipCssString(value, index);
      continue;
    }

    const nameStart = index;
    let name = "";
    while (
      index < value.length &&
      (/[-_a-z\d\u0080-\uffff]/i.test(value[index]!) || value[index] === "\\")
    ) {
      if (value[index] === "\\") {
        const [character, next] = consumeCssEscape(value, index);
        name += character;
        index = next;
      } else {
        name += value[index];
        index += 1;
      }
    }
    if (index === nameStart) {
      index += 1;
      continue;
    }

    const openParen = skipCssWhitespaceAndComments(value, index);
    const functionName = name.toLowerCase();
    if (value[openParen] !== "(" || !RESOURCE_FUNCTIONS.has(functionName))
      continue;

    const closeParen = findCssFunctionEnd(value, openParen);
    if (closeParen === -1) return true;
    const contents = value.slice(openParen + 1, closeParen);
    if (functionName === "url") {
      const start = skipCssWhitespaceAndComments(contents, 0);
      let resource: string;
      if (contents[start] === "'" || contents[start] === '"') {
        const parsed = readCssString(contents.slice(start));
        if (!parsed) return true;
        const trailing = skipCssWhitespaceAndComments(
          contents,
          start + parsed[1],
        );
        if (trailing !== contents.length) return true;
        resource = parsed[0];
      } else {
        resource = decodeCssEscapes(contents).trim();
      }
      if (!isSafeCssResourceUrl(resource)) return true;
    } else if (
      (functionName === "image-set" || functionName === "-webkit-image-set") &&
      hasUnsafeImageSetString(contents)
    ) {
      return true;
    } else if (functionName === "image") {
      const start = skipCssWhitespaceAndComments(contents, 0);
      if (contents[start] === "'" || contents[start] === '"') {
        const parsed = readCssString(contents.slice(start));
        if (!parsed || !isSafeCssResourceUrl(parsed[0])) return true;
      }
    }
    index = openParen + 1;
  }
  return false;
}

function splitTopLevelCssCommas(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; ) {
    if (value.startsWith("/*", index)) index = skipCssComment(value, index);
    else if (value[index] === "'" || value[index] === '"') {
      index = skipCssString(value, index);
    } else if (value[index] === "\\") {
      [, index] = consumeCssEscape(value, index);
    } else if (value[index] === "(") {
      const closeParen = findCssFunctionEnd(value, index);
      if (closeParen === -1) return [value];
      index = closeParen + 1;
    } else if (value[index] === ",") {
      parts.push(value.slice(start, index));
      start = index + 1;
      index += 1;
    } else {
      index += 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function sanitizeCssUrls(value: string): string {
  try {
    const root = postcss.parse(`snapshot { ${value} }`);
    const rule = root.nodes[0];
    if (rule?.type !== "rule") return "";
    const safeDeclarations = rule.nodes.filter(
      (node) => node.type === "decl" && !hasUnsafeCssResource(node.value),
    );
    return safeDeclarations.map((node) => node.toString()).join("; ");
  } catch (error) {
    if (error instanceof Error && error.name === "CssSyntaxError") return "";
    throw error;
  }
}

function sanitizeNode(node: DefaultTreeAdapterTypes.ChildNode): boolean {
  if (!("tagName" in node)) return true;

  const tagName = node.tagName.toLowerCase();
  if (INERT_SNAPSHOT_TAGS.has(tagName)) return false;

  node.attrs = node.attrs.filter((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (tagName === "button" && (name === "name" || name === "value")) {
      return false;
    }
    if (
      name.startsWith("on") ||
      name === "autofocus" ||
      NON_RESOURCE_URL_ATTRIBUTES.has(name) ||
      /^(?:javascript|vbscript):/i.test(value)
    ) {
      return false;
    }
    if (SAFE_RESOURCE_URL_ATTRIBUTES.has(name)) {
      return isSafeSnapshotResourceUrl(value);
    }
    if (
      URL_BEARING_PRESENTATION_ATTRIBUTES.has(name) &&
      hasUnsafeCssResource(value)
    ) {
      return false;
    }
    if (name === "style") attribute.value = sanitizeCssUrls(attribute.value);
    return true;
  });
  node.childNodes = node.childNodes.filter(sanitizeNode);
  return true;
}

/** Remove executable content, navigation controls, and owner-local resources. */
export function sanitizeVisualEditSnapshotHtml(html: string): string {
  const document = parse(html);
  document.childNodes = document.childNodes.filter(sanitizeNode);
  return serialize(document);
}
