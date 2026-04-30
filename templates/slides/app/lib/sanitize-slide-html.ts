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
      if (!/^--?[a-zA-Z][\w-]*$/.test(property) || !value) return null;
      const safeValue = sanitizeCssValue(value);
      return safeValue ? `${property}: ${safeValue}` : null;
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeStyleSheet(css: string): string {
  return css
    .replace(/@import[^;]+;?/gi, "")
    .replace(/([^{}]+)\{([^{}]*)\}/g, (_match, selector, body) => {
      const safeBody = sanitizeStyle(String(body));
      return safeBody ? `${String(selector).trim()} { ${safeBody}; }` : "";
    });
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (DROP_WITH_CHILDREN.has(tag)) return null;

  if (tag === "style") {
    const safeCss = sanitizeStyleSheet(el.textContent ?? "");
    if (!safeCss.trim()) return null;
    const out = doc.createElement("style");
    out.textContent = safeCss;
    return out;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(child, doc);
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
      const safeUrl = sanitizeSlideUrl(value, tag === "img" ? "image" : "link");
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
    const cleaned = cleanNode(child, doc);
    if (cleaned) out.appendChild(cleaned);
  }

  return out;
}

function sanitizeHtmlString(html: string): string {
  return html
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
      const safeCss = sanitizeStyleSheet(String(css));
      return safeCss
        ? `<style>${safeCss.replace(/<\/style/gi, "<\\/style")}</style>`
        : "";
    })
    .replace(
      /<(script|iframe|object|embed|form|input|button|select|textarea|meta|base|link|svg|math)\b[\s\S]*?<\/\1>/gi,
      "",
    )
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
        );
        return safe ? ` ${attr}="${escapeHtml(safe)}"` : "";
      },
    )
    .replace(/\s+style\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (
      _match,
      _raw,
      dq,
      sq,
      bare,
    ) => {
      const safe = sanitizeStyle(dq ?? sq ?? bare ?? "");
      return safe ? ` style="${escapeHtml(safe)}"` : "";
    });
}

export function sanitizeSlideHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return sanitizeHtmlString(html);
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child, doc);
    if (cleaned) fragment.appendChild(cleaned);
  }

  const wrapper = doc.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
