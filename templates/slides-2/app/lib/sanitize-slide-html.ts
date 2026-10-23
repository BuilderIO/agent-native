import { parseBase64DataUrl } from "@agent-native/core/shared";

const SAFE_INLINE_IMAGE_DATA_URL_TYPES = new Set([
  "image/gif",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/avif",
]);

export const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "small",
  "span",
  "source",
  "strong",
  "style",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
]);

export const DROP_WITH_CHILDREN: ReadonlySet<string> = new Set([
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "select",
  "svg",
  "textarea",
]);

const ALLOWED_ATTRS = new Set([
  "align",
  "alt",
  "aria-label",
  "aria-hidden",
  "autoplay",
  "border",
  "cellpadding",
  "cellspacing",
  "class",
  "colspan",
  "controls",
  "height",
  "href",
  "id",
  "loop",
  "role",
  "rowspan",
  "src",
  "style",
  "target",
  "title",
  "muted",
  "playsinline",
  "preload",
  "poster",
  "type",
  "valign",
  "width",
]);

const TAG_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  ol: new Set(["reversed", "start", "type"]),
  li: new Set(["value"]),
};

const URL_ATTRS = new Set(["href", "src", "poster", "xlink:href"]);
const BOOLEAN_VIDEO_ATTRS = new Set([
  "autoplay",
  "controls",
  "loop",
  "muted",
  "playsinline",
]);
const VIDEO_OPENING_TAG_REGEX = /<video\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_NOISE_BACKGROUND_SVGS = 8;
const NOISE_BACKGROUND_MATRIX = "0 0 0 0 0.85 0 0 0 0 0.93 0 0 0 0 1 1 0 0 0 0";
const NOISE_BACKGROUND_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";

type NoiseSvgChild = NoiseSvgNode | { text: string } | { invalid: true };
type NoiseSvgNode = {
  name: string;
  attributes: Record<string, string>;
  children: NoiseSvgChild[];
};
type SafeNoiseSvg = {
  baseFrequency: number;
  numOctaves: number;
  seed: number;
  opacity: number;
  fill: string;
  dataSlideLoc?: string;
};
type NoiseSvgState = { count: number };
type PreservedNoiseSvg = { token: string; markup: string };

function parseNoiseSvgAttributes(
  source: string,
): { attributes: Record<string, string>; selfClosing: boolean } | null {
  const attributes: Record<string, string> = Object.create(null);
  let cursor = 0;

  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor++;
    if (cursor >= source.length) break;
    if (source[cursor] === "/" && !source.slice(cursor + 1).trim()) {
      return { attributes, selfClosing: true };
    }

    const nameMatch = /^[A-Za-z_:][A-Za-z0-9:._-]*/.exec(source.slice(cursor));
    if (!nameMatch) return null;
    const name = nameMatch[0].toLowerCase();
    if (Object.hasOwn(attributes, name)) return null;
    cursor += nameMatch[0].length;
    while (/\s/.test(source[cursor] ?? "")) cursor++;
    if (source[cursor] !== "=") return null;
    cursor++;
    while (/\s/.test(source[cursor] ?? "")) cursor++;
    const quote = source[cursor];
    if (quote !== "'" && quote !== '"') return null;
    cursor++;
    const valueStart = cursor;
    while (cursor < source.length && source[cursor] !== quote) cursor++;
    if (cursor >= source.length) return null;
    const value = source.slice(valueStart, cursor);
    if (/[&<>\u0000-\u001f\u007f]/.test(value)) return null;
    attributes[name] = value;
    cursor++;
  }

  return { attributes, selfClosing: false };
}

function parseNoiseSvgMarkup(markup: string): NoiseSvgNode | null {
  if (!markup || markup.length > 8192) return null;
  let cursor = 0;
  const parsed = { root: null as NoiseSvgNode | null, invalid: false };
  const stack: NoiseSvgNode[] = [];

  const append = (child: NoiseSvgChild) => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(child);
    else if (childTextIsWhitespace(child)) return;
    else if (parsed.root === null && isNoiseSvgNode(child)) {
      parsed.root = child;
    } else {
      parsed.invalid = true;
    }
  };

  while (cursor < markup.length) {
    const tagStart = markup.indexOf("<", cursor);
    const textEnd = tagStart < 0 ? markup.length : tagStart;
    if (textEnd > cursor) append({ text: markup.slice(cursor, textEnd) });
    if (tagStart < 0) break;
    if (markup.startsWith("<!--", tagStart)) {
      const commentEnd = markup.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) return null;
      append({ invalid: true });
      cursor = commentEnd + 3;
      continue;
    }

    let quote = "";
    let tagEnd = tagStart + 1;
    for (; tagEnd < markup.length; tagEnd++) {
      const character = markup[tagEnd]!;
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (tagEnd >= markup.length || quote) return null;
    const token = markup.slice(tagStart, tagEnd + 1);
    const closing = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)\s*>$/.exec(token);
    if (closing) {
      const expected = stack.pop();
      if (!expected || expected.name !== closing[1]!.toLowerCase()) return null;
      cursor = tagEnd + 1;
      continue;
    }

    const opening = /^<([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)>$/.exec(token);
    if (!opening) return null;
    const parsedAttributes = parseNoiseSvgAttributes(opening[2]!);
    if (!parsedAttributes) return null;
    const node: NoiseSvgNode = {
      name: opening[1]!.toLowerCase(),
      attributes: parsedAttributes.attributes,
      children: [],
    };
    append(node);
    if (!parsedAttributes.selfClosing) stack.push(node);
    cursor = tagEnd + 1;
  }

  const root = parsed.root as NoiseSvgNode | null;
  return stack.length === 0 && !parsed.invalid && root?.name === "svg"
    ? root
    : null;
}

function isNoiseSvgNode(value: NoiseSvgChild): value is NoiseSvgNode {
  return "name" in value;
}

function childTextIsWhitespace(value: NoiseSvgChild): boolean {
  return "text" in value && value.text.trim() === "";
}

function noiseSvgElements(node: NoiseSvgNode): NoiseSvgNode[] | null {
  const elements: NoiseSvgNode[] = [];
  for (const child of node.children) {
    if (isNoiseSvgNode(child)) elements.push(child);
    else if (!childTextIsWhitespace(child)) return null;
  }
  return elements;
}

function hasExactNoiseSvgAttributes(
  attributes: Record<string, string>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  return (
    Object.keys(attributes).every((name) => allowed.includes(name)) &&
    required.every((name) => Object.hasOwn(attributes, name))
  );
}

function validateNoiseSvg(node: NoiseSvgNode): SafeNoiseSvg | null {
  const root = node.attributes;
  if (
    !hasExactNoiseSvgAttributes(
      root,
      [
        "xmlns",
        "aria-hidden",
        "focusable",
        "width",
        "height",
        "viewbox",
        "preserveaspectratio",
        "data-slide-loc",
        "data-slides2-noise",
        "style",
      ],
      [
        "xmlns",
        "aria-hidden",
        "focusable",
        "width",
        "height",
        "viewbox",
        "preserveaspectratio",
        "style",
      ],
    ) ||
    root.xmlns !== SVG_NAMESPACE ||
    root["aria-hidden"] !== "true" ||
    root.focusable !== "false" ||
    root.width !== "100%" ||
    root.height !== "100%" ||
    root.viewbox !== "0 0 220 220" ||
    root.preserveaspectratio !== "none" ||
    root.style !== NOISE_BACKGROUND_STYLE ||
    (root["data-slide-loc"] !== undefined &&
      !/^\d{1,6}:\d{1,6}$/.test(root["data-slide-loc"])) ||
    (root["data-slides2-noise"] !== undefined &&
      root["data-slides2-noise"] !== "1")
  ) {
    return null;
  }

  const children = noiseSvgElements(node);
  if (
    !children ||
    children.length !== 2 ||
    children[0]!.name !== "defs" ||
    children[1]!.name !== "rect" ||
    Object.keys(children[0]!.attributes).length > 0
  ) {
    return null;
  }

  const defsChildren = noiseSvgElements(children[0]!);
  if (
    !defsChildren ||
    defsChildren.length !== 1 ||
    defsChildren[0]!.name !== "filter"
  ) {
    return null;
  }
  const filter = defsChildren[0]!;
  const filterAttributes = filter.attributes;
  const id = filterAttributes.id;
  if (
    !hasExactNoiseSvgAttributes(
      filterAttributes,
      ["id", "x", "y", "width", "height"],
      ["id", "x", "y", "width", "height"],
    ) ||
    !/^slides2-noise-\d{1,2}$/.test(id ?? "") ||
    filterAttributes.x !== "0" ||
    filterAttributes.y !== "0" ||
    filterAttributes.width !== "100%" ||
    filterAttributes.height !== "100%"
  ) {
    return null;
  }

  const filterChildren = noiseSvgElements(filter);
  if (
    !filterChildren ||
    filterChildren.length !== 2 ||
    filterChildren[0]!.name !== "feturbulence" ||
    filterChildren[1]!.name !== "fecolormatrix"
  ) {
    return null;
  }
  const turbulence = filterChildren[0]!.attributes;
  const frequency = Number(turbulence.basefrequency);
  const numOctaves = Number(turbulence.numoctaves);
  const seed = Number(turbulence.seed);
  if (
    !hasExactNoiseSvgAttributes(
      turbulence,
      ["type", "basefrequency", "numoctaves", "seed", "stitchtiles", "result"],
      ["type", "basefrequency", "numoctaves", "seed", "stitchtiles", "result"],
    ) ||
    turbulence.type !== "fractalNoise" ||
    !Number.isFinite(frequency) ||
    frequency < 0.0001 ||
    frequency > 1 ||
    !/^\d+$/.test(turbulence.numoctaves ?? "") ||
    !Number.isInteger(numOctaves) ||
    numOctaves < 1 ||
    numOctaves > 4 ||
    !Number.isFinite(seed) ||
    Math.abs(seed) > 10_000 ||
    turbulence.stitchtiles !== "stitch" ||
    turbulence.result !== "noise" ||
    noiseSvgElements(filterChildren[0]!)?.length !== 0
  ) {
    return null;
  }

  const matrix = filterChildren[1]!.attributes;
  if (
    !hasExactNoiseSvgAttributes(
      matrix,
      ["in", "type", "values"],
      ["in", "type", "values"],
    ) ||
    matrix.in !== "noise" ||
    matrix.type !== "matrix" ||
    matrix.values !== NOISE_BACKGROUND_MATRIX ||
    noiseSvgElements(filterChildren[1]!)?.length !== 0
  ) {
    return null;
  }

  const rect = children[1]!.attributes;
  const opacity = Number(rect.opacity);
  if (
    !hasExactNoiseSvgAttributes(
      rect,
      ["width", "height", "filter", "opacity", "fill"],
      ["width", "height", "filter", "opacity", "fill"],
    ) ||
    rect.width !== "100%" ||
    rect.height !== "100%" ||
    rect.filter !== `url(#${id})` ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1 ||
    !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(rect.fill ?? "") ||
    noiseSvgElements(children[1]!)?.length !== 0
  ) {
    return null;
  }

  return {
    baseFrequency: frequency,
    numOctaves,
    seed,
    opacity,
    fill: rect.fill!,
    ...(root["data-slide-loc"] ? { dataSlideLoc: root["data-slide-loc"] } : {}),
  };
}

function noiseSvgNodeFromElement(element: Element): NoiseSvgNode | null {
  if (element.namespaceURI !== SVG_NAMESPACE) return null;
  const attributes: Record<string, string> = Object.create(null);
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (Object.hasOwn(attributes, name)) return null;
    attributes[name] = attribute.value;
  }
  const children: NoiseSvgChild[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const nested = noiseSvgNodeFromElement(child as Element);
      if (!nested) return null;
      children.push(nested);
    } else if (child.nodeType === Node.TEXT_NODE) {
      children.push({ text: child.textContent ?? "" });
    } else {
      children.push({ invalid: true });
    }
  }
  return {
    name: element.tagName.toLowerCase(),
    attributes,
    children,
  };
}

function serializeNoiseSvg(options: SafeNoiseSvg, id: string): string {
  const sourceLocation = options.dataSlideLoc
    ? ` data-slide-loc="${options.dataSlideLoc}"`
    : "";
  return `<svg xmlns="${SVG_NAMESPACE}" aria-hidden="true" focusable="false" width="100%" height="100%" viewBox="0 0 220 220" preserveAspectRatio="none"${sourceLocation} style="${NOISE_BACKGROUND_STYLE}"><defs><filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${options.baseFrequency}" numOctaves="${options.numOctaves}" seed="${options.seed}" stitchTiles="stitch" result="noise"></feTurbulence><feColorMatrix in="noise" type="matrix" values="${NOISE_BACKGROUND_MATRIX}"></feColorMatrix></filter></defs><rect width="100%" height="100%" filter="url(#${id})" opacity="${options.opacity}" fill="${options.fill}"></rect></svg>`;
}

function createNoiseSvgElement(
  doc: Document,
  options: SafeNoiseSvg,
  id: string,
): Element {
  const create = (name: string) => doc.createElementNS(SVG_NAMESPACE, name);
  const svg = create("svg");
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("viewBox", "0 0 220 220");
  svg.setAttribute("preserveAspectRatio", "none");
  if (options.dataSlideLoc) {
    svg.setAttribute("data-slide-loc", options.dataSlideLoc);
  }
  svg.setAttribute("style", NOISE_BACKGROUND_STYLE);

  const defs = create("defs");
  const filter = create("filter");
  filter.setAttribute("id", id);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  const turbulence = create("feTurbulence");
  turbulence.setAttribute("type", "fractalNoise");
  turbulence.setAttribute("baseFrequency", String(options.baseFrequency));
  turbulence.setAttribute("numOctaves", String(options.numOctaves));
  turbulence.setAttribute("seed", String(options.seed));
  turbulence.setAttribute("stitchTiles", "stitch");
  turbulence.setAttribute("result", "noise");
  const matrix = create("feColorMatrix");
  matrix.setAttribute("in", "noise");
  matrix.setAttribute("type", "matrix");
  matrix.setAttribute("values", NOISE_BACKGROUND_MATRIX);
  filter.append(turbulence, matrix);
  defs.append(filter);
  const rect = create("rect");
  rect.setAttribute("width", "100%");
  rect.setAttribute("height", "100%");
  rect.setAttribute("filter", `url(#${id})`);
  rect.setAttribute("opacity", String(options.opacity));
  rect.setAttribute("fill", options.fill);
  svg.append(defs, rect);
  return svg;
}

function findMarkupTagEnd(source: string, start: number): number | null {
  let quote = "";
  for (let cursor = start + 1; cursor < source.length; cursor++) {
    const character = source[cursor]!;
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor + 1;
    }
  }
  return null;
}

function findMatchingSvgEnd(source: string, start: number): number | null {
  let cursor = start;
  let depth = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) return null;
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) return null;
      cursor = commentEnd + 3;
      continue;
    }

    const tagEnd = findMarkupTagEnd(source, tagStart);
    if (tagEnd === null) return null;
    const tag = source.slice(tagStart, tagEnd);
    const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/i.exec(tag);
    if (!match) {
      cursor = tagEnd;
      continue;
    }

    const closing = Boolean(match[1]);
    const name = match[2]!.toLowerCase();
    const selfClosing = /\/\s*>$/.test(tag);
    if (!closing && !selfClosing && (name === "script" || name === "style")) {
      const close = new RegExp(`</\\s*${name}\\s*>`, "ig");
      close.lastIndex = tagEnd;
      const closingTag = close.exec(source);
      if (!closingTag) return null;
      cursor = closingTag.index + closingTag[0].length;
      continue;
    }

    if (name === "svg") {
      if (closing) {
        depth--;
        if (depth === 0) return tagEnd;
      } else if (!selfClosing) {
        depth++;
      } else if (depth === 0) {
        return tagEnd;
      }
    }
    cursor = tagEnd;
  }
  return null;
}

function preserveNoiseBackgroundSvgs(
  html: string,
  state: NoiseSvgState,
): { html: string; preserved: PreservedNoiseSvg[] } {
  const tags = startTagPositions(html).filter((tag) => tag.name === "svg");
  if (tags.length === 0) return { html, preserved: [] };

  const preserved: PreservedNoiseSvg[] = [];
  let output = "";
  let copiedThrough = 0;
  for (const tag of tags) {
    if (tag.index < copiedThrough) continue;
    const end = findMatchingSvgEnd(html, tag.index);
    if (end === null) {
      return {
        html: output + html.slice(copiedThrough, tag.index),
        preserved,
      };
    }

    output += html.slice(copiedThrough, tag.index);
    const parsed = parseNoiseSvgMarkup(html.slice(tag.index, end));
    const options = parsed ? validateNoiseSvg(parsed) : null;
    if (options && state.count < MAX_NOISE_BACKGROUND_SVGS) {
      state.count++;
      const tokenBase = `SLIDES2_SAFE_NOISE_SVG_PLACEHOLDER_${state.count}__`;
      let token = tokenBase;
      while (html.includes(token)) token += "_";
      const id = `slides2-noise-${state.count}`;
      preserved.push({ token, markup: serializeNoiseSvg(options, id) });
      output += token;
    }
    copiedThrough = end;
  }

  return { html: output + html.slice(copiedThrough), preserved };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);?/g, (_, dec: string) =>
        String.fromCodePoint(Number.parseInt(dec, 10)),
      )
      .replace(/&colon;?/gi, ":")
      .replace(/&tab;?/gi, "\t")
      .replace(/&newline;?/gi, "\n")
      .replace(/&amp;?/gi, "&");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function sanitizeSlideUrl(
  rawUrl: string | undefined,
  kind: "link" | "image" | "media" = "link",
  options?: { allowBlob?: boolean },
): string | null {
  const value = String(rawUrl ?? "").trim();
  if (!value) return null;

  const decoded = decodeHtmlEntities(value);
  const normalized = decoded.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  const lower = normalized.toLowerCase();

  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("//")
  ) {
    return null;
  }

  if (lower.startsWith("data:")) {
    if (kind !== "image") return null;
    const dataUrl = parseBase64DataUrl(decoded);
    return dataUrl && SAFE_INLINE_IMAGE_DATA_URL_TYPES.has(dataUrl.mediaType)
      ? value
      : null;
  }

  if (lower.startsWith("blob:")) {
    return (kind === "image" || kind === "media") && options?.allowBlob
      ? value
      : null;
  }

  if (value.startsWith("/") || value.startsWith("#")) return value;
  if (value.startsWith("./") || value.startsWith("../")) return value;

  try {
    const url = new URL(decoded);
    if (kind === "image" || kind === "media") {
      return url.protocol === "http:" || url.protocol === "https:"
        ? value
        : null;
    }
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? value
      : null;
  } catch {
    return /^[a-z][a-z\d+.-]*:/i.test(lower) ? null : value;
  }
}

export function sanitizeCssValue(value: string): string | null {
  const decoded = decodeHtmlEntities(value);
  if (
    /(?:^|[^\w-])expression\s*\(/i.test(decoded) ||
    /(?:java|vb)script\s*:/i.test(decoded) ||
    /(?:^|[^\w-])url\s*\(/i.test(decoded) ||
    /@import/i.test(decoded) ||
    /-moz-binding/i.test(decoded) ||
    /behavior\s*:/i.test(decoded)
  ) {
    return null;
  }
  return value.trim();
}

/** Vendor-prefixed names (`-webkit-text-fill-color`) fail this and are dropped. */
export const isKeptCssProperty = (property: string) =>
  /^(?:--)?[a-zA-Z][\w-]*$/.test(property);

function sanitizeStyle(style: string): string {
  return style
    .split(";")
    .map((declaration) => {
      const idx = declaration.indexOf(":");
      if (idx <= 0) return null;
      const property = declaration.slice(0, idx).trim();
      const value = declaration.slice(idx + 1).trim();
      if (!isKeptCssProperty(property) || !value) return null;
      const safeValue = sanitizeCssValue(value);
      return safeValue ? `${property}: ${safeValue}` : null;
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * A scope prefix left in stored CSS by an earlier save of the rendered DOM.
 * Re-prefixing it would chain two scopes that never match together, which
 * silently turned off every rule of a slide's stylesheet.
 */
const EXISTING_SCOPE_PREFIX =
  /^(?:\[data-slide-content-scope(?:=(?:"[^"]*"|'[^']*'|[^\]\s]*))?\](?:\s+|$))+/;

/** `from`, `to`, `50%`: the only selectors valid inside `@keyframes`, never scopable. */
const KEYFRAME_SELECTOR = /^(?:from|to|\d*\.?\d+%)$/i;

function scopeCssSelector(selector: string, scopeSelector?: string): string {
  const trimmed = selector.trim();
  if (!scopeSelector || !trimmed || trimmed.startsWith("@")) return trimmed;

  return trimmed
    .split(",")
    .map((part) => {
      const scoped = part.trim();
      const item = scoped.replace(EXISTING_SCOPE_PREFIX, "").trim();
      if (!scoped) return "";
      if (!item) return scopeSelector;
      if (KEYFRAME_SELECTOR.test(item)) return item;
      if (item === "*") return `${scopeSelector}, ${scopeSelector} *`;
      if (/^(?:html|body|:root)\b/i.test(item)) {
        return item.replace(/^(?:html|body|:root)\b/i, scopeSelector);
      }
      return `${scopeSelector} ${item}`;
    })
    .filter(Boolean)
    .join(", ");
}

function matchingCssBlockEnd(css: string, openingBrace: number): number {
  let depth = 0;
  let quote = "";
  for (let index = openingBrace; index < css.length; index += 1) {
    const character = css[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && css[index + 1] === "*") {
      const commentEnd = css.indexOf("*/", index + 2);
      if (commentEnd < 0) return -1;
      index = commentEnd + 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return index;
    }
  }
  return -1;
}

function sanitizeKeyframeRules(css: string): string {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
    ([, selector, body]) => {
      const safeSelector = scopeCssSelector(String(selector).trim());
      const safeBody = sanitizeStyle(String(body));
      return safeSelector && safeBody
        ? [`${safeSelector} { ${safeBody}; }`]
        : [];
    },
  );
  return rules.join(" ");
}

function extractGeneratedCropKeyframes(css: string): {
  remaining: string;
  keyframes: string[];
} {
  const pattern = /@keyframes\s+(fmd_crop_[\w-]+)\s*\{/gi;
  const keyframes: string[] = [];
  let remaining = "";
  let copiedThrough = 0;
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    const openingBrace = pattern.lastIndex - 1;
    const closingBrace = matchingCssBlockEnd(css, openingBrace);
    if (closingBrace < 0) break;
    remaining += css.slice(copiedThrough, match.index);
    const body = sanitizeKeyframeRules(
      css.slice(openingBrace + 1, closingBrace),
    );
    if (body.trim()) keyframes.push(`@keyframes ${match[1]} { ${body} }`);
    copiedThrough = closingBrace + 1;
    pattern.lastIndex = copiedThrough;
  }
  remaining += css.slice(copiedThrough);
  return { remaining, keyframes };
}

function sanitizeStyleSheet(css: string, scopeSelector?: string): string {
  const withoutImports = css.replace(/@import[^;]+;?/gi, "");
  const { remaining, keyframes } =
    extractGeneratedCropKeyframes(withoutImports);
  const rules = remaining.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (_match, selector, body) => {
      const safeBody = sanitizeStyle(String(body));
      const safeSelector = scopeCssSelector(String(selector), scopeSelector);
      return safeBody && safeSelector ? `${safeSelector} { ${safeBody}; }` : "";
    },
  );
  return [...keyframes, rules].filter(Boolean).join(" ");
}

function cleanNode(
  node: Node,
  doc: Document,
  scopeSelector?: string,
  allowBlobImages = false,
  allowBlobVideos = false,
  disableVideoAutoplay = false,
  noiseSvgState: NoiseSvgState = { count: 0 },
): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "svg") {
    const tree = noiseSvgNodeFromElement(el);
    const options = tree ? validateNoiseSvg(tree) : null;
    if (!options || noiseSvgState.count >= MAX_NOISE_BACKGROUND_SVGS) {
      return null;
    }
    noiseSvgState.count++;
    return createNoiseSvgElement(
      doc,
      options,
      `slides2-noise-${noiseSvgState.count}`,
    );
  }

  if (DROP_WITH_CHILDREN.has(tag)) return null;

  if (tag === "style") {
    const safeCss = sanitizeStyleSheet(el.textContent ?? "", scopeSelector);
    if (!safeCss.trim()) return null;
    const out = doc.createElement("style");
    out.textContent = safeCss;
    return out;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(
        child,
        doc,
        undefined,
        allowBlobImages,
        allowBlobVideos,
        disableVideoAutoplay,
        noiseSvgState,
      );
      if (cleaned) fragment.appendChild(cleaned);
    }
    return fragment;
  }

  const out = doc.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith("on")) continue;
    if (name === "srcdoc" || name === "srcset") continue;
    if (
      !ALLOWED_ATTRS.has(name) &&
      !TAG_ATTRS[tag]?.has(name) &&
      !name.startsWith("data-") &&
      !name.startsWith("aria-")
    ) {
      continue;
    }
    if (URL_ATTRS.has(name)) {
      const kind =
        name === "poster" || tag === "img"
          ? "image"
          : tag === "video" || tag === "source"
            ? "media"
            : "link";
      const safeUrl = sanitizeSlideUrl(value, kind, {
        allowBlob: kind === "image" ? allowBlobImages : allowBlobVideos,
      });
      if (!safeUrl) continue;
      out.setAttribute(name, safeUrl);
      continue;
    }
    if (name === "style") {
      const safeStyle = sanitizeStyle(value);
      if (safeStyle) out.setAttribute("style", safeStyle);
      continue;
    }
    if (tag === "video" && BOOLEAN_VIDEO_ATTRS.has(name)) {
      if (value.toLowerCase() === "false") {
        continue;
      }
      if (name === "autoplay" && disableVideoAutoplay) {
        out.setAttribute("data-video-autoplay", "true");
        continue;
      }
      out.setAttribute(name, "");
      continue;
    }
    if (name === "preload" && !["none", "metadata", "auto"].includes(value)) {
      continue;
    }
    if (
      tag === "source" &&
      name === "type" &&
      !["video/mp4", "video/webm"].includes(
        value.toLowerCase().split(";")[0]?.trim() ?? "",
      )
    ) {
      continue;
    }
    if (name === "target" && value !== "_blank") continue;
    out.setAttribute(name, value);
  }

  if (tag === "video") {
    const autoplayConfigured =
      out.hasAttribute("autoplay") ||
      out.getAttribute("data-video-autoplay") === "true";
    if (
      autoplayConfigured &&
      !disableVideoAutoplay &&
      out.hasAttribute("data-video-autoplay")
    ) {
      out.setAttribute("autoplay", "");
    }
    if (autoplayConfigured) {
      out.setAttribute("muted", "");
      out.setAttribute("playsinline", "");
    }
  }

  if (tag === "a") {
    out.setAttribute("target", "_blank");
    out.setAttribute("rel", "noopener noreferrer");
  }

  for (const child of Array.from(el.childNodes)) {
    const cleaned = cleanNode(
      child,
      doc,
      scopeSelector,
      allowBlobImages,
      allowBlobVideos,
      disableVideoAutoplay,
      noiseSvgState,
    );
    if (cleaned) out.appendChild(cleaned);
  }

  return out;
}

const SWALLOWING_ELEMENTS = /^(script|style|textarea|iframe|object|svg|math)$/i;

const RAW_TEXT_ELEMENTS = /^(script|style|textarea|title)$/i;

function startTagPositions(
  html: string,
): { name: string; index: number; end: number }[] {
  const found: { name: string; index: number; end: number }[] = [];
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "<") continue;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 2;
      continue;
    }
    const name = /^<([a-z][a-z0-9-]*)/i.exec(html.slice(i, i + 32))?.[1];
    let cursor = i + 1;
    let quote = "";
    while (cursor < html.length) {
      const char = html[cursor];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      cursor++;
    }
    if (!name) {
      i = cursor;
      continue;
    }
    const lower = name.toLowerCase();
    found.push({ name: lower, index: i, end: cursor });
    if (RAW_TEXT_ELEMENTS.test(lower)) {
      const closing = new RegExp(`</\\s*${lower}\\s*>`, "i").exec(
        html.slice(cursor),
      );
      if (!closing) return found;
      i = cursor + closing.index + closing[0].length - 1;
      continue;
    }
    i = cursor;
  }
  return found;
}

function dropFromFirstUnclosedRawText(html: string): string {
  for (const { name, index } of startTagPositions(html)) {
    if (!SWALLOWING_ELEMENTS.test(name)) continue;
    const closing = new RegExp(`</\\s*${name}\\s*>`, "i");
    if (!closing.test(html.slice(index))) return html.slice(0, index);
  }
  return html;
}

function normalizeTagAttributeSeparators(html: string): string {
  const tags = startTagPositions(html);
  if (!tags.length) return html;
  let out = "";
  let copied = 0;
  for (const { index, end } of tags) {
    const nameEnd = /^<[a-z][a-z0-9-]*/i.exec(html.slice(index, end))?.[0]
      .length;
    if (nameEnd === undefined) continue;
    const from = index + nameEnd;
    let region = "";
    let quote = "";
    for (let i = from; i < end; i++) {
      const char = html[i];
      if (quote) {
        if (char === quote) quote = "";
        region += char;
      } else if (char === '"' || char === "'") {
        quote = char;
        region += char;
      } else if (char === "/") {
        region += " ";
      } else {
        region += char;
      }
    }
    out += html.slice(copied, from) + region;
    copied = end;
  }
  return out + html.slice(copied);
}

function sanitizeHtmlString(
  html: string,
  scopeSelector?: string,
  allowBlobImages = false,
  allowBlobVideos = false,
  disableVideoAutoplay = false,
): string {
  const normalized = normalizeTagAttributeSeparators(html);
  const noiseSvgState: NoiseSvgState = { count: 0 };
  const preservedNoise = preserveNoiseBackgroundSvgs(normalized, noiseSvgState);
  const sanitized = preservedNoise.html
    .replace(/<style\b[^>]*>([\s\S]*?)<\/\s*style\s*>/gi, (_match, css) => {
      const safeCss = sanitizeStyleSheet(String(css), scopeSelector);
      return safeCss
        ? `<style>${safeCss.replace(/<\/style/gi, "<\\/style")}</style>`
        : "";
    })
    .replace(
      /<(script|iframe|object|embed|form|input|button|select|textarea|meta|base|link|svg|math)\b[\s\S]*?<\/\s*\1\s*>/gi,
      "",
    )
    // Anything left here is a blocked element that never closed. The opening-tag
    // pass below would strip only its tag and leave the body behind as slide
    // text — which is how a script's JavaScript renders as visible copy on the
    // SSR'd share/present pages, where DOMParser is undefined and this regex
    // twin runs instead of cleanNode(). An unclosed raw-text or embedding
    // element swallows the rest of the document in a real parser, so dropping
    // the remainder is what keeps this path agreeing with the DOM path.
    .replace(/[\s\S]*/, dropFromFirstUnclosedRawText)
    .replace(
      /<(script|iframe|object|embed|form|input|button|select|textarea|meta|base|link|svg|math)\b[^>]*\/?>/gi,
      "",
    )
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(href|src|poster|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (match, attr, _raw, dq, sq, bare, offset: number, source: string) => {
        const value = dq ?? sq ?? bare ?? "";
        const tagName = /<([a-z][\w-]*)\b[^<>]*$/i
          .exec(source.slice(0, offset))?.[1]
          ?.toLowerCase();
        const kind =
          String(attr).toLowerCase() === "poster" || tagName === "img"
            ? "image"
            : tagName === "video" || tagName === "source"
              ? "media"
              : "link";
        const safe = sanitizeSlideUrl(value, kind, {
          allowBlob: kind === "image" ? allowBlobImages : allowBlobVideos,
        });
        return safe ? ` ${attr}="${escapeHtml(safe)}"` : "";
      },
    )
    .replace(
      /\s+style\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (_match, _raw, dq, sq, bare) => {
        const safe = sanitizeStyle(dq ?? sq ?? bare ?? "");
        return safe ? ` style="${escapeHtml(safe)}"` : "";
      },
    );
  const withoutFalseBooleanMediaAttrs = sanitized.replace(
    VIDEO_OPENING_TAG_REGEX,
    (tag) =>
      tag.replace(
        /"[^"]*"|'[^']*'|\s+(autoplay|controls|loop|muted|playsinline)\s*=\s*(?:"false"|'false'|false)(?=\s|\/?>)/gi,
        (match, attribute: string | undefined) => (attribute ? "" : match),
      ),
  );
  const output = withoutFalseBooleanMediaAttrs.replace(
    VIDEO_OPENING_TAG_REGEX,
    (tag) => {
      const hasAutoplay = /\sautoplay(?:\s|=|\/?>)/i.test(tag);
      const hasAutoplayMarker =
        /\sdata-video-autoplay\s*=\s*(?:"true"|'true'|true)(?=\s|\/?>)/i.test(
          tag,
        );
      const autoplayConfigured = hasAutoplay || hasAutoplayMarker;
      let normalizedTag = tag;

      if (disableVideoAutoplay && hasAutoplay) {
        normalizedTag = normalizedTag.replace(
          /\sautoplay(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,
          "",
        );
        normalizedTag = normalizedTag.replace(
          /\s*\/?\s*>$/,
          (end) => ` data-video-autoplay="true"${end}`,
        );
      } else if (!disableVideoAutoplay && hasAutoplayMarker && !hasAutoplay) {
        normalizedTag = normalizedTag.replace(
          /\s*\/?\s*>$/,
          (end) => ` autoplay${end}`,
        );
      }

      if (autoplayConfigured) {
        for (const attribute of ["muted", "playsinline"]) {
          if (
            new RegExp(`\\s${attribute}(?:\\s|=|\\/>|>)`, "i").test(
              normalizedTag,
            )
          ) {
            continue;
          }
          normalizedTag = normalizedTag.replace(
            /\s*\/?\s*>$/,
            (end) => ` ${attribute}${end}`,
          );
        }
      }
      return normalizedTag;
    },
  );
  return preservedNoise.preserved.reduce(
    (value, item) => value.replaceAll(item.token, item.markup),
    output,
  );
}

export function sanitizeSlideHtml(
  html: string,
  options?: {
    scopeSelector?: string;
    allowBlobImages?: boolean;
    allowBlobVideos?: boolean;
    disableVideoAutoplay?: boolean;
  },
): string {
  const scopeSelector = options?.scopeSelector;
  const allowBlobImages = options?.allowBlobImages ?? false;
  const allowBlobVideos = options?.allowBlobVideos ?? false;
  const disableVideoAutoplay = options?.disableVideoAutoplay ?? false;
  if (typeof DOMParser === "undefined") {
    return sanitizeHtmlString(
      html,
      scopeSelector,
      allowBlobImages,
      allowBlobVideos,
      disableVideoAutoplay,
    );
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.createDocumentFragment();
  const noiseSvgState: NoiseSvgState = { count: 0 };
  for (const style of Array.from(doc.head.querySelectorAll("style"))) {
    const cleaned = cleanNode(
      style,
      doc,
      scopeSelector,
      allowBlobImages,
      allowBlobVideos,
      disableVideoAutoplay,
      noiseSvgState,
    );
    if (cleaned) fragment.appendChild(cleaned);
  }
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(
      child,
      doc,
      scopeSelector,
      allowBlobImages,
      allowBlobVideos,
      disableVideoAutoplay,
      noiseSvgState,
    );
    if (cleaned) fragment.appendChild(cleaned);
  }

  const wrapper = doc.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
