const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
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

// `id` and `class` are intentionally excluded. The mail iframe interpolates
// `headHtml` raw (so author-supplied `<style>` rules in the email's <head>
// reach the page), and CSS-only attacks like `#secret { background:url(...) }`
// or `.password-input[value^="a"] { ... }` rely on body-side selectors that
// match `id` / `class`. Stripping them in the body sanitizer breaks those
// chains regardless of what the head contributes. Most legitimate emails
// style with inline `style=""` (which we also strip) or via the head; very
// few rely on classes targeting the body. (audit 03 finding H7).
const ALLOWED_ATTRS = new Set([
  "align",
  "alt",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "height",
  "href",
  "role",
  "rowspan",
  "src",
  "title",
  "width",
]);

const SAFE_URL_RE =
  /^(?:https?:\/\/|mailto:|tel:|\/|#|cid:|data:image\/(?:gif|png|jpe?g|webp);base64,)/i;

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return false;
  return SAFE_URL_RE.test(trimmed);
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3) {
    return doc.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== 1) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (
    tag === "script" ||
    tag === "style" ||
    tag === "iframe" ||
    tag === "object" ||
    tag === "embed" ||
    tag === "form" ||
    tag === "input" ||
    tag === "button"
  ) {
    return null;
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
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) {
      continue;
    }
    out.setAttribute(name, attr.value);
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

export function sanitizeHtml(html: string): string {
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
