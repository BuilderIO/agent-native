const ALLOWED_TAGS = new Set([
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
]);

const DROP_WITH_CHILDREN = new Set([
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
  "border",
  "cellpadding",
  "cellspacing",
  "class",
  "colspan",
  "height",
  "href",
  "id",
  "role",
  "rowspan",
  "src",
  "style",
  "target",
  "title",
  "valign",
  "width",
]);

const URL_ATTRS = new Set(["href", "src", "poster", "xlink:href"]);

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
  kind: "link" | "image" = "link",
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
    return kind === "image" &&
      /^data:image\/(?:gif|png|jpe?g|webp|avif);base64,/i.test(decoded)
      ? value
      : null;
  }

  // Local object URLs are only a client-side rendering affordance. They must
  // be explicitly enabled so the default sanitizer cannot persist them.
  if (lower.startsWith("blob:")) {
    return kind === "image" && options?.allowBlob ? value : null;
  }

  if (value.startsWith("/") || value.startsWith("#")) return value;
  if (value.startsWith("./") || value.startsWith("../")) return value;

  try {
    const url = new URL(decoded);
    if (kind === "image") {
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

function sanitizeStyle(style: string): string {
  return style
    .split(";")
    .map((declaration) => {
      const idx = declaration.indexOf(":");
      if (idx <= 0) return null;
      const property = declaration.slice(0, idx).trim();
      const value = declaration.slice(idx + 1).trim();
      if (!/^(?:--)?[a-zA-Z][\w-]*$/.test(property) || !value) return null;
      const safeValue = sanitizeCssValue(value);
      return safeValue ? `${property}: ${safeValue}` : null;
    })
    .filter(Boolean)
    .join("; ");
}

function scopeCssSelector(selector: string, scopeSelector?: string): string {
  const trimmed = selector.trim();
  if (!scopeSelector || !trimmed || trimmed.startsWith("@")) return trimmed;

  return trimmed
    .split(",")
    .map((part) => {
      const item = part.trim();
      if (!item) return "";
      if (item === "*") return `${scopeSelector}, ${scopeSelector} *`;
      if (/^(?:html|body|:root)\b/i.test(item)) {
        return item.replace(/^(?:html|body|:root)\b/i, scopeSelector);
      }
      return `${scopeSelector} ${item}`;
    })
    .filter(Boolean)
    .join(", ");
}

function sanitizeStyleSheet(css: string, scopeSelector?: string): string {
  return css
    .replace(/@import[^;]+;?/gi, "")
    .replace(/([^{}]+)\{([^{}]*)\}/g, (_match, selector, body) => {
      const safeBody = sanitizeStyle(String(body));
      const safeSelector = scopeCssSelector(String(selector), scopeSelector);
      return safeBody && safeSelector ? `${safeSelector} { ${safeBody}; }` : "";
    });
}

function cleanNode(
  node: Node,
  doc: Document,
  scopeSelector?: string,
  allowBlobImages = false,
): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

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
      const cleaned = cleanNode(child, doc, undefined, allowBlobImages);
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
      !name.startsWith("data-") &&
      !name.startsWith("aria-")
    ) {
      continue;
    }
    if (URL_ATTRS.has(name)) {
      const safeUrl = sanitizeSlideUrl(
        value,
        tag === "img" ? "image" : "link",
        { allowBlob: allowBlobImages },
      );
      if (!safeUrl) continue;
      out.setAttribute(name, safeUrl);
      continue;
    }
    if (name === "style") {
      const safeStyle = sanitizeStyle(value);
      if (safeStyle) out.setAttribute("style", safeStyle);
      continue;
    }
    if (name === "target" && value !== "_blank") continue;
    out.setAttribute(name, value);
  }

  if (tag === "a") {
    out.setAttribute("target", "_blank");
    out.setAttribute("rel", "noopener noreferrer");
  }

  for (const child of Array.from(el.childNodes)) {
    const cleaned = cleanNode(child, doc, scopeSelector, allowBlobImages);
    if (cleaned) out.appendChild(cleaned);
  }

  return out;
}

/**
 * Elements whose unclosed start tag swallows the rest of the document in a real
 * parser. `embed` is deliberately absent: it is void, so it never has a closing
 * tag and requiring one would truncate every slide that contains a valid one.
 */
const SWALLOWING_ELEMENTS = /^(script|style|textarea|iframe|object|svg|math)$/i;

/** Elements whose children the HTML parser reads as text rather than markup. */
const RAW_TEXT_ELEMENTS = /^(script|style|textarea|title)$/i;

/**
 * Start-tag positions in `html`, skipping comments and anything inside a quoted
 * attribute value.
 *
 * Scanning the serialized string with a bare regex cannot tell a tag from text:
 * `<p title="Use <style> here">` reads as a `<style>` start tag, and truncating
 * there drops the rest of a perfectly valid slide.
 */
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
    // Walk to this tag's `>`, stepping over quoted values so a `<` or `>`
    // inside one is not read as markup.
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
      // A raw-text element's body is text, not markup — `content: "<script>"`
      // inside a stylesheet is a CSS string, and reading it as a start tag
      // truncated everything after it. Skip to the close tag; no close tag is
      // the unclosed case the caller is looking for, and everything past it is
      // swallowed anyway, so there is nothing further to find.
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

/**
 * Truncates at the first swallowing element that never closes.
 *
 * The regex path has to drop the remainder to agree with `cleanNode`. It must
 * check for the closing tag to do that: the sweep used to match any of these
 * tags and cut to the end of the string unconditionally, which ate the
 * sanitized `<style>` block the pass above it had just emitted — and every
 * heading and paragraph after it. A deck with one stylesheet rendered as an
 * empty slide on the SSR'd share and present pages.
 */
function dropFromFirstUnclosedRawText(html: string): string {
  for (const { name, index } of startTagPositions(html)) {
    if (!SWALLOWING_ELEMENTS.test(name)) continue;
    const closing = new RegExp(`</\\s*${name}\\s*>`, "i");
    if (!closing.test(html.slice(index))) return html.slice(0, index);
  }
  return html;
}

/**
 * Rewrites `/` attribute separators inside start tags as spaces.
 *
 * `/` is a legal separator between attributes, so `<img src="x"/onerror="…">`
 * is an image with a live handler — and every attribute scrub below is anchored
 * on whitespace, so none of them matched it. Normalizing here rather than
 * widening each scrub to `[\s/]+` is what keeps a legitimate value intact: a
 * URL like `https://cdn.example/onerror=logo.png` lives inside quotes, and this
 * only touches separators outside them.
 */
function normalizeTagAttributeSeparators(html: string): string {
  const tags = startTagPositions(html);
  if (!tags.length) return html;
  let out = "";
  let copied = 0;
  for (const { index, end } of tags) {
    // Start after the tag name so `</p>` and the opening `<` are untouched.
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
): string {
  return (
    normalizeTagAttributeSeparators(html)
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
        /\s+(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (match, attr, _raw, dq, sq, bare) => {
          const value = dq ?? sq ?? bare ?? "";
          const safe = sanitizeSlideUrl(
            value,
            String(attr).toLowerCase() === "src" ? "image" : "link",
            { allowBlob: allowBlobImages },
          );
          return safe ? ` ${attr}="${escapeHtml(safe)}"` : "";
        },
      )
      .replace(
        /\s+style\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (_match, _raw, dq, sq, bare) => {
          const safe = sanitizeStyle(dq ?? sq ?? bare ?? "");
          return safe ? ` style="${escapeHtml(safe)}"` : "";
        },
      )
  );
}

export function sanitizeSlideHtml(
  html: string,
  options?: { scopeSelector?: string; allowBlobImages?: boolean },
): string {
  const scopeSelector = options?.scopeSelector;
  const allowBlobImages = options?.allowBlobImages ?? false;
  if (typeof DOMParser === "undefined") {
    return sanitizeHtmlString(html, scopeSelector, allowBlobImages);
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.createDocumentFragment();
  for (const style of Array.from(doc.head.querySelectorAll("style"))) {
    const cleaned = cleanNode(style, doc, scopeSelector, allowBlobImages);
    if (cleaned) fragment.appendChild(cleaned);
  }
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child, doc, scopeSelector, allowBlobImages);
    if (cleaned) fragment.appendChild(cleaned);
  }

  const wrapper = doc.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
