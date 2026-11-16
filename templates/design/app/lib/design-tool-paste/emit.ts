import type { FigmaPasteLayer } from "@shared/figma-paste-plan";

import {
  inexact,
  PASTE_LIMITS,
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

function cssProperty(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function declaration(
  name: string,
  value: string | number,
  warnings: PasteWarnings,
): string | null {
  if (!STYLE_PROPERTIES.has(name)) {
    warnings.push(inexact(`Skipped the unsupported "${name}" style.`));
    return null;
  }
  const text =
    typeof value === "number" && !UNITLESS.has(name)
      ? `${value}px`
      : String(value);
  if (!VALUE_GRAMMAR.test(text) || RESOURCE_FUNCTION.test(text)) {
    warnings.push(inexact(`Skipped an unsafe ${name} value.`));
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
  truncated: boolean;
}

function styleAttribute(
  style: PasteStyle,
  extra: Array<string | null>,
  walk: Walk,
  skip: ReadonlySet<string> = new Set(),
): string {
  const parts = [
    ...Object.entries(style)
      .filter(([name]) => !skip.has(name))
      .map(([name, value]) => declaration(name, value, walk.warnings)),
    ...extra,
  ].filter(Boolean);
  return parts.length > 0 ? ` style="${escapeHtml(parts.join(";"))}"` : "";
}

function fontDeclaration(font: PasteFont | undefined, walk: Walk) {
  if (!font) return [];
  walk.fonts.add(font.family);
  return [`font-family:${fontFamilyCss(font)}`];
}

function attributes(attrs: Record<string, string>, walk: Walk): string {
  return Object.entries(attrs)
    .map(([name, value]) => {
      if (!SVG_ATTRIBUTES.has(name) || /[<>"]/.test(name)) {
        walk.warnings.push(
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
        walk.warnings.push(
          inexact(`Skipped an unsafe ${name} attribute value.`),
        );
        return "";
      }
      return ` ${name}="${escapeHtml(value)}"`;
    })
    .join("");
}

function imageDeclarations(
  images: PasteImage[],
  walk: Walk,
): Array<string | null> {
  const linked = images.filter((image) => {
    if (HTTPS_URL.test(image.url)) return true;
    walk.warnings.push(inexact("Skipped an image Design cannot link to."));
    return false;
  });
  if (linked.length === 0) return [];
  for (const image of linked) walk.imageUrls.add(image.url);
  const layered = (
    pick: (image: PasteImage) => string | undefined,
    fallback: string,
  ) => linked.map((image) => pick(image) ?? fallback).join(",");
  return [
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
}

function allowedTag(tag: string | undefined, fallback: string, walk: Walk) {
  if (tag === undefined) return fallback;
  if (BOX_TAGS.has(tag)) return tag;
  walk.warnings.push(
    inexact(`Rendered the unsupported "${tag}" element as a ${fallback}.`),
  );
  return fallback;
}

function nodeHtml(node: PasteNode, depth: number, walk: Walk): string {
  if (walk.truncated) return "";
  if (depth > PASTE_LIMITS.depth || walk.nodes >= PASTE_LIMITS.nodes) {
    walk.warnings.push(
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
        walk.warnings.push(
          inexact(`Drew an unsupported "${node.tag}" shape as a path.`),
        );
      }
      return `<${tag}${attributes(node.attrs, walk)}></${tag}>`;
    }
    case "svg": {
      const inner = node.children
        .map((child) => nodeHtml(child, depth + 1, walk))
        .join("");
      return `<svg data-agent-native-layer-name="${escapeHtml(node.label)}"${attributes(node.attrs, walk)}${styleAttribute(node.style, [], walk)} xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    }
    case "text": {
      const tag = allowedTag(node.tag, "span", walk);
      return `<${tag} data-agent-native-layer-name="${escapeHtml(node.label)}"${styleAttribute(node.style, fontDeclaration(node.font, walk), walk)}>${escapeHtml(node.text)}</${tag}>`;
    }
    case "box": {
      const tag = allowedTag(node.tag, "div", walk);
      const extra = [
        ...fontDeclaration(node.font, walk),
        ...(node.images ? imageDeclarations(node.images, walk) : []),
      ];
      const inner = node.children
        .map((child) => nodeHtml(child, depth + 1, walk))
        .join("");
      return `<${tag} data-agent-native-layer-name="${escapeHtml(node.label)}"${styleAttribute(node.style, extra, walk)}>${inner}</${tag}>`;
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
  const layers = frames.map((frame) => {
    const walk: Walk = {
      warnings,
      fonts: new Set(),
      imageUrls,
      nodes: 0,
      truncated: false,
    };
    const body = nodeHtml(frame.root, 0, walk);
    return {
      title: frame.title,
      width: size(frame.width),
      height: size(frame.height),
      content: `<!DOCTYPE html><html><head>${fontLinks(walk.fonts)}</head><body>${body}</body></html>`,
      wrapsLooseNode: false,
      origin: frame.origin,
      sourceOffset: null,
    };
  });
  return { layers, imageUrls: Array.from(imageUrls) };
}
