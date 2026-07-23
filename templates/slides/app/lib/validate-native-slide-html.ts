const MAX_NATIVE_SLIDE_BYTES = 64 * 1024 * 1024;

const ALLOWED_TAGS = new Set([
  "a",
  "br",
  "div",
  "img",
  "p",
  "span",
  "table",
  "tbody",
  "td",
  "tr",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "alt",
  "class",
  "colspan",
  "data-fallback-reason",
  "data-source-object-id",
  "data-source-slide-id",
  "rowspan",
  "src",
  "style",
]);

const ALLOWED_CSS_PROPERTIES = new Set([
  "align-items",
  "background",
  "background-color",
  "border",
  "border-bottom",
  "border-collapse",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "box-sizing",
  "clip-path",
  "color",
  "display",
  "direction",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "filter",
  "flex-direction",
  "height",
  "justify-content",
  "left",
  "line-height",
  "margin",
  "object-fit",
  "opacity",
  "overflow",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "position",
  "table-layout",
  "text-align",
  "text-decoration",
  "text-indent",
  "top",
  "transform",
  "transform-origin",
  "vertical-align",
  "width",
  "z-index",
]);

export function validateNativeSlideHtml(html: string): string {
  if (new TextEncoder().encode(html).byteLength > MAX_NATIVE_SLIDE_BYTES) {
    throw new Error("Slides-native artifact exceeds the 64 MiB clone limit.");
  }
  if (
    !/^<div\s[^>]*class="[^"]*\bfmd-slide\b[^"]*\bgoogle-slides-native\b/i.test(
      html.trimStart(),
    )
  ) {
    throw new Error("Slides-native artifact is missing its compiler root.");
  }
  if (
    /<\/?(?:script|style|svg|iframe|object|embed|link|meta|form|input|button)\b/i.test(
      html,
    ) ||
    /\son[a-z]+\s*=/i.test(html) ||
    /\s(?:href|srcset|srcdoc)\s*=/i.test(html)
  ) {
    throw new Error("Slides-native artifact contains forbidden active markup.");
  }

  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)([^>]*)>/gi)) {
    const tag = match[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      throw new Error(
        `Slides-native artifact contains forbidden <${tag}> markup.`,
      );
    }
    if (match[0].startsWith("</") || tag === "br") continue;
    validateAttributes(tag, match[2] ?? "");
  }
  return html;
}

function validateAttributes(tag: string, source: string): void {
  let consumed = "";
  for (const match of source.matchAll(/\s+([a-z][a-z0-9-]*)="([^"]*)"/gi)) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? "";
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      throw new Error(
        `Slides-native artifact contains forbidden ${name} attribute.`,
      );
    }
    if (name === "src") {
      if (
        tag !== "img" ||
        !/^\/_agent-native\/creative-context\/media\?mediaId=ccm_[a-f0-9]{28}$/.test(
          value,
        )
      ) {
        throw new Error("Slides-native artifact contains an unsafe asset URL.");
      }
    }
    if (name === "class") {
      for (const token of value.split(/\s+/).filter(Boolean)) {
        if (
          token !== "fmd-slide" &&
          token !== "google-slides-native" &&
          token !== "google-slides-source-canvas" &&
          !/^gslide-[a-z0-9_-]+$/.test(token)
        ) {
          throw new Error(
            "Slides-native artifact contains an unexpected class.",
          );
        }
      }
    }
    if (name === "style") validateStyle(value);
    consumed += match[0];
  }
  const remainder = source.replace(consumed, "").replace(/\/$/, "").trim();
  if (remainder) {
    throw new Error("Slides-native artifact contains malformed attributes.");
  }
}

function validateStyle(value: string): void {
  if (
    /(?:url\s*\(|expression\s*\(|@import|javascript:|vbscript:|data:|\\)/i.test(
      value,
    )
  ) {
    throw new Error("Slides-native artifact contains unsafe CSS.");
  }
  for (const declaration of value.split(";")) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(":");
    if (separator <= 0) {
      throw new Error("Slides-native artifact contains malformed CSS.");
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    if (!ALLOWED_CSS_PROPERTIES.has(property)) {
      throw new Error(
        `Slides-native artifact contains forbidden ${property} CSS.`,
      );
    }
  }
}
