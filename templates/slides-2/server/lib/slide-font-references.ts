import { parseFragment, type DefaultTreeAdapterTypes as P5 } from "parse5";
import postcss from "postcss";

import {
  isSafeSlideFontFamily,
  MAX_SLIDE_RENDER_FONT_FAMILIES,
} from "../../shared/slide-design-tokens.js";

const GENERIC_FONT_FAMILIES = new Set([
  "cursive",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

const isElement = (node: P5.Node): node is P5.Element => "tagName" in node;
const isText = (node: P5.Node): node is P5.TextNode =>
  node.nodeName === "#text";

export class SlideFontReferenceParseError extends Error {
  constructor() {
    super("Slide CSS could not be parsed while resolving font references.");
    this.name = "SlideFontReferenceParseError";
  }
}

function addFontFamilyStack(value: string, families: Set<string>): void {
  for (const item of value.match(/"[^\"]*"|'[^']*'|[^,]+/g) ?? []) {
    let family = item.trim();
    if (
      (family.startsWith('"') && family.endsWith('"')) ||
      (family.startsWith("'") && family.endsWith("'"))
    ) {
      family = family.slice(1, -1).trim();
    }
    if (
      isSafeSlideFontFamily(family) &&
      !GENERIC_FONT_FAMILIES.has(family.toLowerCase())
    ) {
      families.add(family);
    }
  }
}

function addCssFontFamilies(css: string, families: Set<string>): void {
  try {
    postcss.parse(css).walkDecls("font-family", (declaration) => {
      addFontFamilyStack(declaration.value, families);
    });
  } catch (error) {
    if (error instanceof Error && error.name === "CssSyntaxError") {
      throw new SlideFontReferenceParseError();
    }
    throw error;
  }
}

function visitHtmlNode(node: P5.Node, families: Set<string>): void {
  if (isElement(node)) {
    for (const attribute of node.attrs) {
      if (attribute.name === "style") {
        addCssFontFamilies(attribute.value, families);
      } else if (attribute.name === "font-family") {
        addFontFamilyStack(attribute.value, families);
      }
    }
    if (node.tagName === "style") {
      addCssFontFamilies(
        node.childNodes
          .filter(isText)
          .map((child) => child.value)
          .join(""),
        families,
      );
    }
    node.childNodes.forEach((child) => visitHtmlNode(child, families));
  }
}

export function readSlideFontReferences(input: {
  html: string;
  styles?: readonly string[];
  designFonts?: { display: string; body: string };
  tokenFamilies?: readonly string[];
}): string[] {
  const families = new Set<string>();
  for (const child of parseFragment(input.html).childNodes) {
    visitHtmlNode(child, families);
  }
  for (const style of input.styles ?? []) addCssFontFamilies(style, families);
  if (input.designFonts) {
    addFontFamilyStack(input.designFonts.display, families);
    addFontFamilyStack(input.designFonts.body, families);
  }
  for (const family of input.tokenFamilies ?? []) {
    addFontFamilyStack(family, families);
  }
  if (families.size > MAX_SLIDE_RENDER_FONT_FAMILIES) {
    throw new Error("slide-font-family-limit");
  }
  return [...families].sort();
}
