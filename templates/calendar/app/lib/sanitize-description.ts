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

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return false;
  return /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmed);
}

function walkNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3 ) {
    return doc.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== 1 ) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "script" || tag === "style") return null;

  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleaned = walkNode(child, doc);
      if (cleaned) fragment.appendChild(cleaned);
    }
    return fragment;
  }

  const out = doc.createElement(tag);

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) continue;
    out.setAttribute(name, attr.value);
  }

  if (tag === "a") {
    out.setAttribute("target", "_blank");
    out.setAttribute("rel", "noopener noreferrer");
  }

  for (const child of Array.from(el.childNodes)) {
    const cleaned = walkNode(child, doc);
    if (cleaned) out.appendChild(cleaned);
  }

  return out;
}

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

function isBoilerplateContainer(el: Element): boolean {
  const text = el.textContent ?? "";
  if (/\bYes\b/.test(text) && /\bNo\b/.test(text) && /\bMaybe\b/.test(text)) {
    return true;
  }
  return GCAL_STRIP_PATTERNS.some((re) => re.test(text));
}

function isBoilerplateSectionHeading(el: Element): boolean {
  if (el.tagName !== "B" && el.tagName !== "STRONG") return false;
  const text = (el.textContent ?? "").trim();
  return GCAL_STRIP_BOLD.some((re) => re.test(text));
}

export function stripGcalInviteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const el of Array.from(doc.body.querySelectorAll("table, div"))) {
    if (isBoilerplateContainer(el)) {
      el.remove();
    }
  }

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

  for (const b of Array.from(doc.body.querySelectorAll("b, strong"))) {
    if (!isBoilerplateSectionHeading(b)) continue;
    const parent = b.parentElement;
    if (!parent) continue;
    const container =
      parent.tagName === "P" || parent.tagName === "DIV" ? parent : b;
    let sibling = container.nextSibling;
    container.remove();
    while (sibling) {
      const next = sibling.nextSibling;
      const sEl = sibling.nodeType === 1 ? (sibling as Element) : null;
      if (sEl?.tagName === "HR") break;
      if (sEl?.querySelector("b, strong")) {
        const inner = sEl.querySelector("b, strong")!;
        if (isBoilerplateSectionHeading(inner)) break;
        const innerText = (inner.textContent ?? "").trim();
        if (innerText.length > 0) break;
      }
      sibling.parentNode?.removeChild(sibling);
      sibling = next;
    }
  }

  for (const el of Array.from(doc.body.querySelectorAll("p, div, span"))) {
    if ((el.textContent ?? "").trim() === "" && !el.querySelector("img")) {
      el.remove();
    }
  }

  let prevHr: Element | null = null;
  for (const hr of Array.from(doc.body.querySelectorAll("hr"))) {
    if (prevHr && hr.previousElementSibling === prevHr) {
      hr.remove();
    } else {
      prevHr = hr;
    }
  }

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

export function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

export function linkifyText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return escaped.replace(URL_RE, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:hsl(var(--primary));text-decoration:underline;word-break:break-all;">${url}</a>`;
  });
}
