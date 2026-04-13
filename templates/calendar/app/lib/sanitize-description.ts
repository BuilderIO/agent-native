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

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|tel:|\/|#)/i;

/** Recursively walk a DOM node, keeping only allowed tags/attrs. */
function walkNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3 /* TEXT */) {
    return doc.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== 1 /* ELEMENT */) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Drop <script> and <style> entirely (including children)
  if (tag === "script" || tag === "style") return null;

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
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === "href" || name === "src") && !SAFE_URL_RE.test(attr.value))
      continue;
    out.setAttribute(name, attr.value);
  }

  // Force links to open in new tab
  if (tag === "a") {
    out.setAttribute("target", "_blank");
    out.setAttribute("rel", "noopener noreferrer");
  }

  // Recurse into children (skip for void elements)
  for (const child of Array.from(el.childNodes)) {
    const cleaned = walkNode(child, doc);
    if (cleaned) out.appendChild(cleaned);
  }

  return out;
}

/**
 * Sanitize HTML using an allowlist approach with DOMParser.
 * Only permits known-safe tags and attributes, stripping everything else.
 */
export function sanitizeHtml(html: string): string {
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

// ── GCal invite stripping ──────────────────────────────────────────────────
// Google Calendar embeds invitation boilerplate (guest list, RSVP buttons,
// "Invitation from Google Calendar" footer) into descriptions. We render
// those natively, so strip them to avoid duplication.

const GCAL_STRIP_PATTERNS = [
  /Reply\s+for/i,
  /More\s+options/i,
  /Invitation\s+from\s+Google\s+Calendar/i,
  /You\s+are\s+receiving\s+this/i,
  /View\s+all\s+guest\s+info/i,
  /Joining\s+instructions/i,
];

const GCAL_STRIP_BOLD = [
  /^When$/i,
  /^Join\s+Zoom\s+Meeting$/i,
  /^Join\s+by\s+phone$/i,
];

/** Check if a container element's text matches any of the boilerplate patterns */
function isBoilerplateContainer(el: Element): boolean {
  const text = el.textContent ?? "";
  // Check if the element has Yes/No/Maybe buttons
  if (/\bYes\b/.test(text) && /\bNo\b/.test(text) && /\bMaybe\b/.test(text)) {
    return true;
  }
  return GCAL_STRIP_PATTERNS.some((re) => re.test(text));
}

/** Check if element is a <b> heading that starts a boilerplate section */
function isBoilerplateSectionHeading(el: Element): boolean {
  if (el.tagName !== "B" && el.tagName !== "STRONG") return false;
  const text = (el.textContent ?? "").trim();
  return GCAL_STRIP_BOLD.some((re) => re.test(text));
}

/**
 * Strip Google Calendar invitation boilerplate from event descriptions.
 */
export function stripGcalInviteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Pass 1: Remove table/div containers that contain boilerplate text
  for (const el of Array.from(doc.body.querySelectorAll("table, div"))) {
    if (isBoilerplateContainer(el)) {
      el.remove();
    }
  }

  // Pass 2: Remove links that are boilerplate
  for (const a of Array.from(doc.body.querySelectorAll("a"))) {
    const text = (a.textContent ?? "").trim();
    if (
      /^More\s+options$/i.test(text) ||
      /^View\s+all\s+guest\s+info$/i.test(text) ||
      /^Joining\s+instructions$/i.test(text)
    ) {
      a.remove();
    }
  }

  // Pass 3: Remove boilerplate content (Invitation from Google Calendar, etc.)
  // Walk all elements and text nodes — check textContent which spans across children
  const BOILERPLATE_RE = [
    /Invitation\s+from\s+Google\s+Calendar/i,
    /You\s+are\s+receiving\s+this/i,
  ];
  for (const child of Array.from(doc.body.querySelectorAll("*"))) {
    const text = child.textContent ?? "";
    if (BOILERPLATE_RE.some((re) => re.test(text))) {
      child.remove();
    }
  }
  // Also catch bare text nodes at the body level (e.g. "Invitation from " before <a>)
  for (const child of Array.from(doc.body.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (
        /Invitation\s+from/i.test(text) ||
        /You\s+are\s+receiving/i.test(text)
      ) {
        child.parentNode?.removeChild(child);
      }
    }
  }

  // Pass 4: Remove <b>When</b>/<b>Join Zoom Meeting</b> sections and everything
  // until the next section heading or <hr>
  for (const b of Array.from(doc.body.querySelectorAll("b, strong"))) {
    if (!isBoilerplateSectionHeading(b)) continue;
    // Remove siblings from this <b> until we hit another section or <hr>
    const parent = b.parentElement;
    if (!parent) continue;
    // If the <b> is inside a <p>, remove from the parent level
    const container =
      parent.tagName === "P" || parent.tagName === "DIV" ? parent : b;
    let sibling = container.nextSibling;
    // Remove the heading element/container itself
    container.remove();
    // Remove following siblings until a boundary
    while (sibling) {
      const next = sibling.nextSibling;
      const sEl = sibling.nodeType === 1 ? (sibling as Element) : null;
      if (sEl?.tagName === "HR") break;
      if (sEl?.querySelector("b, strong")) {
        const inner = sEl.querySelector("b, strong")!;
        if (isBoilerplateSectionHeading(inner)) break;
        // Different heading — stop
        const innerText = (inner.textContent ?? "").trim();
        if (innerText.length > 0) break;
      }
      sibling.parentNode?.removeChild(sibling);
      sibling = next;
    }
  }

  // Pass 5: Remove empty elements and collapse excessive whitespace
  for (const el of Array.from(doc.body.querySelectorAll("p, div, span"))) {
    if ((el.textContent ?? "").trim() === "" && !el.querySelector("img")) {
      el.remove();
    }
  }

  // Collapse multiple consecutive <hr> into one
  let prevHr: Element | null = null;
  for (const hr of Array.from(doc.body.querySelectorAll("hr"))) {
    if (prevHr && hr.previousElementSibling === prevHr) {
      hr.remove();
    } else {
      prevHr = hr;
    }
  }

  // Trim leading/trailing <br> and <hr> elements
  while (doc.body.firstChild) {
    const child = doc.body.firstChild;
    if (child.nodeType === 3 && (child.textContent ?? "").trim() === "") {
      child.remove();
      continue;
    }
    if (child.nodeType === 1) {
      const tag = (child as Element).tagName;
      if (tag === "BR" || tag === "HR") {
        child.remove();
        continue;
      }
    }
    break;
  }
  while (doc.body.lastChild) {
    const child = doc.body.lastChild;
    if (child.nodeType === 3 && (child.textContent ?? "").trim() === "") {
      child.remove();
      continue;
    }
    if (child.nodeType === 1) {
      const tag = (child as Element).tagName;
      if (tag === "BR" || tag === "HR") {
        child.remove();
        continue;
      }
    }
    break;
  }

  return doc.body.innerHTML.trim();
}

/** Check if a string looks like HTML */
export function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

const URL_RE = /https?:\/\/[^\s<>"&{}|\\^`[\]]+/g;

/**
 * Convert plain-text URLs to clickable <a> tags.
 * Returns HTML — use with dangerouslySetInnerHTML.
 */
export function linkifyText(text: string): string {
  // Escape HTML entities first to prevent XSS
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return escaped.replace(URL_RE, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary underline break-all">${url}</a>`;
  });
}
