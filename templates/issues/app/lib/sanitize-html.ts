const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "img",
  "sub",
  "sup",
]);

const ALLOWED_ATTRS = new Set([
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "class",
  "id",
  "colspan",
  "rowspan",
]);

const DROP_WITH_CHILDREN = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "select",
  "textarea",
  "button",
  "link",
  "meta",
  "base",
  "svg",
  "math",
]);

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return false;
  return /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmed);
}

/** Recursively walk a DOM node, keeping only allowed tags/attrs. */
function walkNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3 /* TEXT */) {
    return doc.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== 1 /* ELEMENT */) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Drop dangerous tags entirely (including children)
  if (DROP_WITH_CHILDREN.has(tag)) return null;

  // If the tag isn't allowed, promote its children directly
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleaned = walkNode(child, doc);
      if (cleaned) fragment.appendChild(cleaned);
    }
    return fragment;
  }

  // Allowed tag — recreate with only allowed attrs
  const out = doc.createElement(tag);

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // Strip all on* event-handler attributes outright
    if (name.startsWith("on")) continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) continue;
    out.setAttribute(name, attr.value);
  }

  // Force links to open in new tab
  if (tag === "a") {
    out.setAttribute("target", "_blank");
    out.setAttribute("rel", "noopener noreferrer");
  }

  // Recurse into children
  for (const child of Array.from(el.childNodes)) {
    const cleaned = walkNode(child, doc);
    if (cleaned) out.appendChild(cleaned);
  }

  return out;
}

/**
 * Sanitize HTML using a DOM-based allowlist (DOMParser walker). Far more
 * robust than regex-based stripping — DOMParser normalises malformed HTML,
 * resolves entities, and exposes a real tree we can rebuild from. Only
 * known-safe tags/attrs survive; everything else (including all `on*`
 * event handlers, `<script>`, `<style>`, `<iframe>`, SVG/MathML payloads,
 * and `srcdoc`/`srcset` smuggling) is stripped.
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    // SSR / non-browser fallback — strip the obvious dangerous tags. The
    // production rendering path (IssueDescription) runs in the browser so
    // this branch is defensive only.
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.createDocumentFragment();

  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = walkNode(child, doc);
    if (cleaned) fragment.appendChild(cleaned);
  }

  const wrapper = doc.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
