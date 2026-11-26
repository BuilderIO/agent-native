import type { FigmaPasteLayer } from "@shared/figma-paste-plan";

import {
  inexact,
  PASTE_LIMITS,
  pushWarning,
  type PasteFont,
  type PasteFrame,
  type PasteImage,
  type PasteNode,
  type PasteStyle,
  type PasteWarnings,
} from "./ir";

// Names, tags and attributes outside these sets are dropped with a warning:
// the payload is another app's data, so only what Design renders is allowed.
const STYLE_PROPERTIES = new Set(
  `display position top right bottom left zIndex width height minWidth minHeight
maxWidth maxHeight aspectRatio overflow overflowX overflowY boxSizing flex
flexDirection flexWrap flexGrow flexShrink flexBasis alignItems alignContent
alignSelf justifyContent justifyItems justifySelf placeItems gap rowGap
columnGap order gridTemplateColumns gridTemplateRows gridColumn gridRow
gridAutoFlow gridAutoColumns gridAutoRows padding paddingTop paddingRight
paddingBottom paddingLeft paddingInline paddingBlock margin marginTop
marginRight marginBottom marginLeft marginInline marginBlock color
backgroundColor fontSize fontStyle fontWeight lineHeight letterSpacing
textAlign textDecoration textTransform textOverflow whiteSpace wordBreak
textIndent border borderTop borderRight borderBottom borderLeft borderRadius
borderTopLeftRadius borderTopRightRadius borderBottomRightRadius
borderBottomLeftRadius boxShadow opacity filter backdropFilter mixBlendMode
transform transformOrigin objectFit objectPosition backgroundSize
backgroundPosition backgroundRepeat`.split(/\s+/),
);

const BOX_TAGS = new Set([
  "div",
  "span",
  "p",
  "section",
  "header",
  "footer",
  "main",
  "nav",
  "article",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const SHAPE_TAGS = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
]);

const SVG_ATTRIBUTES = new Set(
  `width height viewBox preserveAspectRatio d cx cy r rx ry x y x1 y1 x2 y2
points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity
fill-opacity fill-rule clip-rule opacity transform`.split(/\s+/),
);

const SYSTEM_FONTS = new Set([
  "-apple-system",
  "blinkmacsystemfont",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
]);

const UNITLESS = new Set([
  "aspectRatio",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "opacity",
  "order",
  "zIndex",
]);

// Characters a CSS value here can need; anything else (`;`, braces, quotes,
// backslashes, angle brackets) could end the declaration or the attribute.
const VALUE_GRAMMAR = /^[\w\s.,%#()/+*-]+$/;
const RESOURCE_FUNCTION = /(?:url|expression|image-set|attr)\s*\(/i;
// CSS drops comments before it tokenizes, so `url/**/(...)` is still a url().
const CSS_COMMENT = /\/\*|\*\//;
const HTTPS_URL = /^https:\/\/[^\s"'()\\<>]+$/;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) =>
    char === "&"
      ? "&amp;"
      : char === "<"
        ? "&lt;"
        : char === ">"
          ? "&gt;"
          : "&quot;",
  );
}

function isSafeValue(text: string): boolean {
  return (
    VALUE_GRAMMAR.test(text) &&
    !RESOURCE_FUNCTION.test(text) &&
    !CSS_COMMENT.test(text)
  );
}

function cssProperty(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function declaration(
  name: string,
  value: string | number,
  warnings: PasteWarnings,
): string | null {
  if (!STYLE_PROPERTIES.has(name)) {
    pushWarning(warnings, inexact(`Skipped the unsupported "${name}" style.`));
    return null;
  }
  const text =
    typeof value === "number" && !UNITLESS.has(name)
      ? `${value}px`
      : String(value);
  if (!isSafeValue(text)) {
    pushWarning(warnings, inexact(`Skipped an unsafe ${name} value.`));
    return null;
  }
  return `${cssProperty(name)}:${text}`;
}

/** Quote a family unless it is a bare CSS identifier such as `-apple-system`. */
function fontFamilyCss(font: PasteFont): string {
  const name = /^-?[A-Za-z_][\w-]*$/.test(font.family)
    ? font.family
    : `'${font.family.replace(/['\;{}<>]/g, "")}'`;
  const rest =
    font.fallback && /^[\w\s,'"-]+$/.test(font.fallback)
      ? font.fallback
      : "sans-serif";
  return `${name},${rest}`;
}

/** One stylesheet per family, so a family Google Fonts lacks cannot break the rest. */
function fontLinks(families: Iterable<string>): string {
  return Array.from(new Set(families))
    .filter((family) => !SYSTEM_FONTS.has(family.toLowerCase()))
    .sort()
    .map((family) => {
      const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
      return `<link rel="stylesheet" href="${escapeHtml(href)}">`;
    })
    .join("");
}

interface Walk {
  warnings: PasteWarnings;
  fonts: Set<string>;
  imageUrls: Set<string>;
  nodes: number;
  /** Bytes of HTML emitted so far, and the most this frame may emit. */
  bytes: number;
  byteLimit: number;
  truncated: boolean;
}

function styleAttribute(
  style: PasteStyle,
  extra: Array<string | null>,
  walk: Walk,
  skip: ReadonlySet<string> = new Set(),
): string {
  const entries = Object.entries(style).filter(([name]) => !skip.has(name));
  if (entries.length > PASTE_LIMITS.styleProperties) {
    // A record this large is read only as far as the limit, so it cannot
    // generate a warning per key.
    pushWarning(
      walk.warnings,
      inexact(
        `Read only the first ${PASTE_LIMITS.styleProperties} style properties of a layer.`,
      ),
    );
  }
  const parts = [
    ...entries
      .slice(0, PASTE_LIMITS.styleProperties)
      .map(([name, value]) => declaration(name, value, walk.warnings)),
    ...extra,
  ].filter(Boolean);
  return parts.length > 0 ? ` style="${escapeHtml(parts.join(";"))}"` : "";
}

function fontDeclaration(font: PasteFont | undefined, walk: Walk) {
  if (!font) return [];
  const known = walk.fonts.has(font.family);
  if (
    font.family.length <= PASTE_LIMITS.fontFamilyChars &&
    (known || walk.fonts.size < PASTE_LIMITS.fontFamilies)
  ) {
    walk.fonts.add(font.family);
  } else if (!known) {
    // Still styled with it, but no stylesheet is fetched for it.
    pushWarning(
      walk.warnings,
      inexact("Did not load every font the copy uses."),
    );
  }
  return [`font-family:${fontFamilyCss(font)}`];
}

function attributes(attrs: Record<string, string>, walk: Walk): string {
  return Object.entries(attrs)
    .map(([name, value]) => {
      if (!SVG_ATTRIBUTES.has(name) || /[<>"]/.test(name)) {
        pushWarning(
          walk.warnings,
          inexact(`Skipped the unsupported "${name}" attribute.`),
        );
        return "";
      }
      // Escaping does not stop SVG resolving `fill="url(https://...)"`, so a
      // value gets the same grammar and no-resource rule as a style value.
      if (
        value !== "" &&
        !(VALUE_GRAMMAR.test(value) && !RESOURCE_FUNCTION.test(value))
      ) {
        pushWarning(
          walk.warnings,
          inexact(`Skipped an unsafe ${name} attribute value.`),
        );
        return "";
      }
      return ` ${name}="${escapeHtml(value)}"`;
    })
    .join("");
}

/** The declarations for a layer's image fills, and the URLs they link to. */
function imageDeclarations(
  images: PasteImage[],
  walk: Walk,
): { declarations: Array<string | null>; urls: string[] } {
  if (images.length > PASTE_LIMITS.imageFills) {
    pushWarning(
      walk.warnings,
      inexact(
        `Kept the first ${PASTE_LIMITS.imageFills} image fills of a layer.`,
      ),
    );
  }
  const linked = images.slice(0, PASTE_LIMITS.imageFills).filter((image) => {
    if (HTTPS_URL.test(image.url)) return true;
    pushWarning(
      walk.warnings,
      inexact("Skipped an image Design cannot link to."),
    );
    return false;
  });
  if (linked.length === 0) return { declarations: [], urls: [] };
  const layered = (
    pick: (image: PasteImage) => string | undefined,
    fallback: string,
  ) => linked.map((image) => pick(image) ?? fallback).join(",");
  const declarations = [
    `background-image:${linked.map((image) => `url("${image.url}")`).join(",")}`,
    declaration(
      "backgroundSize",
      layered((i) => i.size, "auto"),
      walk.warnings,
    ),
    declaration(
      "backgroundPosition",
      layered((i) => i.position, "0% 0%"),
      walk.warnings,
    ),
    declaration(
      "backgroundRepeat",
      layered((i) => i.repeat, "repeat"),
      walk.warnings,
    ),
  ];
  return { declarations, urls: linked.map((image) => image.url) };
}

/** A layer's name, bounded so escaping it cannot grow a temporary string far past the budget. */
function layerName(label: string): string {
  return escapeHtml(label.slice(0, PASTE_LIMITS.labelChars));
}

function allowedTag(tag: string | undefined, fallback: string, walk: Walk) {
  if (tag === undefined) return fallback;
  if (BOX_TAGS.has(tag)) return tag;
  pushWarning(
    walk.warnings,
    inexact(`Rendered the unsupported "${tag}" element as a ${fallback}.`),
  );
  return fallback;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes +=
      code < 0x80
        ? 1
        : code < 0x800
          ? 2
          : code >= 0xd800 && code < 0xdc00
            ? 2
            : 3;
  }
  return bytes;
}

/**
 * Counts what a node writes against the frame's budget before its children
 * are visited. Over budget, the rest of the frame is dropped and reported.
 */
function charge(walk: Walk, ...parts: string[]): boolean {
  const size = parts.reduce((total, part) => total + utf8Length(part), 0);
  // Only output that is kept counts, so a node that does not fit cannot use up
  // the budget that later frames of the paste still have.
  if (walk.bytes + size <= walk.byteLimit) {
    walk.bytes += size;
    return true;
  }
  truncate(walk);
  return false;
}

function truncate(walk: Walk): void {
  if (walk.truncated) return;
  pushWarning(
    walk.warnings,
    inexact(`Stopped at the ${walk.byteLimit} byte limit for one frame.`),
  );
  walk.truncated = true;
}

/**
 * True when text this long cannot fit the remaining budget even unescaped, so
 * it is refused before escaping can grow it several-fold.
 */
function overBudget(walk: Walk, rawLength: number): boolean {
  if (rawLength <= walk.byteLimit - walk.bytes) return false;
  truncate(walk);
  return true;
}

function nodeHtml(node: PasteNode, depth: number, walk: Walk): string {
  if (walk.truncated) return "";
  if (depth > PASTE_LIMITS.depth || walk.nodes >= PASTE_LIMITS.nodes) {
    pushWarning(
      walk.warnings,
      inexact(
        depth > PASTE_LIMITS.depth
          ? `Stopped at ${PASTE_LIMITS.depth} nested layers.`
          : `Stopped after ${PASTE_LIMITS.nodes} layers.`,
      ),
    );
    walk.truncated = true;
    return "";
  }
  walk.nodes += 1;
  switch (node.kind) {
    case "shape": {
      const tag = SHAPE_TAGS.has(node.tag) ? node.tag : "path";
      if (tag !== node.tag) {
        pushWarning(
          walk.warnings,
          inexact(`Drew an unsupported "${node.tag}" shape as a path.`),
        );
      }
      const open = `<${tag}${attributes(node.attrs, walk)}>`;
      const close = `</${tag}>`;
      return charge(walk, open, close) ? open + close : "";
    }
    case "svg": {
      const open = `<svg data-agent-native-layer-name="${layerName(node.label)}"${attributes(node.attrs, walk)}${styleAttribute(node.style, [], walk)} xmlns="http://www.w3.org/2000/svg">`;
      if (!charge(walk, open, "</svg>")) return "";
      const inner = node.children
        .map((child) => nodeHtml(child, depth + 1, walk))
        .join("");
      return `${open}${inner}</svg>`;
    }
    case "text": {
      if (overBudget(walk, node.text.length)) return "";
      const tag = allowedTag(node.tag, "span", walk);
      const open = `<${tag} data-agent-native-layer-name="${layerName(node.label)}"${styleAttribute(node.style, fontDeclaration(node.font, walk), walk)}>`;
      const text = escapeHtml(node.text);
      const close = `</${tag}>`;
      return charge(walk, open, text, close) ? open + text + close : "";
    }
    case "box": {
      const tag = allowedTag(node.tag, "div", walk);
      const images = node.images
        ? imageDeclarations(node.images, walk)
        : { declarations: [], urls: [] };
      const extra = [
        ...fontDeclaration(node.font, walk),
        ...images.declarations,
      ];
      const open = `<${tag} data-agent-native-layer-name="${layerName(node.label)}"${styleAttribute(node.style, extra, walk)}>`;
      const close = `</${tag}>`;
      if (!charge(walk, open, close)) return "";
      // Only a layer that is kept may send its images to be hosted.
      for (const url of images.urls) walk.imageUrls.add(url);
      const inner = node.children
        .map((child) => nodeHtml(child, depth + 1, walk))
        .join("");
      return `${open}${inner}${close}`;
    }
  }
}

function size(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export interface EmittedPaste {
  layers: FigmaPasteLayer[];
  /** Remote images the layers link to, deduplicated, for the caller to host. */
  imageUrls: string[];
}

export function emitFrames(
  frames: PasteFrame[],
  warnings: PasteWarnings,
): EmittedPaste {
  const imageUrls = new Set<string>();
  let remaining: number = PASTE_LIMITS.totalBytes;
  const layers = frames.map((frame) => {
    const walk: Walk = {
      warnings,
      fonts: new Set(),
      imageUrls,
      nodes: 0,
      bytes: 0,
      byteLimit: Math.max(0, Math.min(PASTE_LIMITS.frameBytes, remaining)),
      truncated: false,
    };
    const body = nodeHtml(frame.root, 0, walk);
    const links = fontLinks(walk.fonts);
    // The font links are bounded (a few families, short names) and sit inside
    // the margin left under the frame limit; they still count against the
    // paste-wide budget.
    remaining -= walk.bytes + utf8Length(links);
    return {
      title: frame.title,
      width: size(frame.width),
      height: size(frame.height),
      content: `<!DOCTYPE html><html><head>${links}</head><body>${body}</body></html>`,
      wrapsLooseNode: false,
      origin: frame.origin,
      sourceOffset: null,
    };
  });
  return { layers, imageUrls: Array.from(imageUrls) };
}
