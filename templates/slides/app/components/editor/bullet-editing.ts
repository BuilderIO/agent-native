/**
 * Helpers for editing styled bullet lists — list-item rows built from a marker
 * glyph plus text (e.g. `<div><span>●</span><span>Point</span></div>`) rather
 * than real <ul>/<li> markup, which is how generated decks represent bullets.
 *
 * Kept in a standalone module (no React exports) so SlideEditor stays
 * Fast-Refresh friendly and this logic is unit-testable.
 */

/** Zero-width space: keeps the caret inside an otherwise-empty text span so
 * typed characters inherit that span's font instead of the container's. */
export const ZERO_WIDTH_SPACE = "\u200B";

/** Single glyphs commonly used as bullet markers in styled (non-<ul>) lists. */
const BULLET_GLYPHS = new Set([
  "\u2022", // •
  "\u25CF", // ●
  "\u25E6", // ◦
  "\u25AA", // ▪
  "\u2023", // ‣
  "\u00B7", // ·
  "\u2043", // ⁃
  "-",
  "\u2013", // –
  "\u2014", // —
  "*",
]);

/** True if an element is a bullet marker — either a text glyph (a leading ●
 * span) or an empty CSS shape (a small square/dot/box span used as a marker). */
export function isBulletMarker(el: Element): boolean {
  return isGlyphMarker(el) || isShapeMarker(el);
}

/** A leading span whose text is only bullet glyph characters (e.g. "●"). */
function isGlyphMarker(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  return text.length > 0 && [...text].every((c) => BULLET_GLYPHS.has(c));
}

/** An empty, small, roughly-square span drawn as a marker via border/background
 * (e.g. `<span style="width:21px;height:21px;border:2px solid ...">`), which is
 * how generated decks often render checkbox/dot bullets with no text glyph. */
function isShapeMarker(el: Element): boolean {
  if ((el.textContent ?? "").trim().length > 0) return false;
  if (el.childElementCount > 0) return false;
  const w = parseCssPx(styleValue(el, "width"));
  const h = parseCssPx(styleValue(el, "height"));
  if (!(w > 0 && h > 0) || w > 48 || h > 48) return false;
  const ratio = w / h;
  if (ratio < 0.5 || ratio > 2) return false;
  const hasBorder =
    parseCssPx(styleValue(el, "border-top-width")) > 0 ||
    parseCssPx(styleValue(el, "border-left-width")) > 0 ||
    parseCssPx(styleValue(el, "border-width")) > 0;
  const bg = styleValue(el, "background-color");
  const hasBg = !!bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
  const hasRadius = parseCssPx(styleValue(el, "border-radius")) > 0;
  return hasBorder || hasBg || hasRadius;
}

/** Read a style property, preferring inline styles and falling back to computed
 * styles when available (jsdom-safe). */
function styleValue(el: Element, prop: string): string {
  const inline = (el as HTMLElement).style?.getPropertyValue(prop);
  if (inline) return inline;
  if (typeof window !== "undefined" && window.getComputedStyle) {
    try {
      return window.getComputedStyle(el).getPropertyValue(prop);
    } catch {
      return "";
    }
  }
  return "";
}

function parseCssPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The bullet-marker element enclosing a node (or the node itself), bounded by
 * `root`, or null when the node isn't inside a marker glyph. */
function enclosingMarker(node: Node, root: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  while (el && el !== root && root.contains(el)) {
    if (isBulletMarker(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * A "bullet row" is a styled list item whose first element child is a marker
 * glyph. The text after it may be a <span> or a bare text node (contentEditable
 * often unwraps spans while editing), and may be empty for a freshly-added
 * bullet — so only the leading marker is required.
 */
export function isBulletRow(el: HTMLElement): boolean {
  if (el.tagName !== "DIV" && el.tagName !== "LI" && el.tagName !== "P") {
    return false;
  }
  const first = el.firstElementChild;
  return !!first && isBulletMarker(first);
}

/** Count the styled bullet rows directly inside a container. */
export function bulletRowCount(el: HTMLElement): number {
  return Array.from(el.children).filter((k) => isBulletRow(k as HTMLElement))
    .length;
}

/** A container whose element children are (essentially) all styled bullet rows. */
export function isBulletList(el: HTMLElement): boolean {
  const kids = Array.from(el.children);
  if (kids.length === 0) return false;
  const rows = bulletRowCount(el);
  // Tolerate one stray non-bullet child (e.g. a stray <br>/<div> left behind by
  // contentEditable) as long as the container is clearly a bullet list.
  return rows >= 1 && rows >= kids.length - 1;
}

/** Regex for a markdown-style bullet prefix: a dash or asterisk plus a space,
 * at the very start of a block's content (e.g. "- " or "* "). */
const MARKDOWN_BULLET_PREFIX = /^[-*] $/;

/**
 * If `el`'s content starts with a markdown-style "- "/"* " prefix and the
 * caret sits right after it, convert `el`'s content into a styled bullet row
 * — a small marker span plus a text span holding the rest of `el`'s content —
 * nested inside `el`, which becomes the list container. `el` itself must stay
 * the contentEditable root (nesting the row rather than turning `el` itself
 * into the row) so a later Enter's cloned sibling row lands inside the same
 * contentEditable boundary and is actually typeable. Returns false when `el`
 * is already a bullet row/list, there's no such prefix, or the selection
 * isn't a collapsed caret.
 */
export function convertMarkdownPrefixToBullet(el: HTMLElement): boolean {
  if (isBulletRow(el) || isBulletList(el)) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const caretRange = sel.getRangeAt(0);
  if (!caretRange.collapsed) return false;

  const beforeCaretRange = document.createRange();
  beforeCaretRange.selectNodeContents(el);
  beforeCaretRange.setEnd(caretRange.endContainer, caretRange.endOffset);
  if (!MARKDOWN_BULLET_PREFIX.test(beforeCaretRange.toString())) return false;
  beforeCaretRange.deleteContents();

  const marker = document.createElement("span");
  marker.style.fontSize = "0.3em";
  marker.style.position = "relative";
  marker.style.top = "-0.15em";
  marker.textContent = "\u25CF";

  const textSpan = document.createElement("span");
  while (el.firstChild) textSpan.appendChild(el.firstChild);
  const restFirstChild = textSpan.firstChild;
  if (!restFirstChild) {
    textSpan.appendChild(document.createTextNode(ZERO_WIDTH_SPACE));
  }

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "baseline";
  row.style.gap = "0.7em";
  row.append(marker, textSpan);
  el.append(row);

  if (!el.style.display) el.style.display = "flex";
  if (!el.style.flexDirection) el.style.flexDirection = "column";
  if (!el.style.gap) el.style.gap = "0.6em";

  const range = document.createRange();
  if (restFirstChild) {
    range.setStartBefore(restFirstChild);
  } else {
    // See primeNewRow: anchor the caret inside the placeholder text node
    // (not an element-based position) so it keeps the text span's font
    // instead of falling back to the marker's.
    const zws = textSpan.firstChild as Text;
    range.setStart(zws, ZERO_WIDTH_SPACE.length);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/**
 * Walk up from a text leaf to the nearest enclosing styled bullet-row
 * container, so Enter can add a new item to the whole list instead of being
 * trapped inside one item.
 */
export function findEnclosingList(
  el: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && root.contains(node)) {
    const parentEl: HTMLElement | null = node.parentElement;
    if (!parentEl) break;
    if (isBulletRow(node) && isBulletList(parentEl)) return parentEl;
    // Even from a bullet row whose siblings aren't all bullets, treat the
    // parent as a list once it holds two or more bullet rows.
    if (isBulletRow(node) && bulletRowCount(parentEl) >= 2) return parentEl;
    node = parentEl;
  }
  return null;
}

/** The non-marker text container of a row: a dedicated text <span> if present,
 * otherwise the row itself (rows whose text is a bare node). */
function rowTextContainer(
  row: HTMLElement,
  marker: HTMLElement | null,
): HTMLElement {
  const textSpan = Array.from(row.children).find(
    (c) => c.tagName === "SPAN" && c !== marker && !isBulletMarker(c),
  ) as HTMLElement | undefined;
  return textSpan ?? row;
}

/**
 * Seed a freshly-inserted row with the caret's trailing content and place the
 * caret at the start of its editable text. `tail` is a DOM fragment (not a
 * string) so inline formatting such as <strong>/<em> carried over from the
 * split point is preserved. When there is no tail, a zero-width space text node
 * keeps the caret inside the font-carrying text span rather than dropping it to
 * the container.
 */
function primeNewRow(row: HTMLElement, tail: DocumentFragment | null): void {
  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;
  const container = rowTextContainer(row, marker);

  // Clear existing text content, preserving the marker glyph.
  if (container !== row) {
    container.replaceChildren();
  } else {
    while (marker?.nextSibling) marker.nextSibling.remove();
    if (!marker) row.replaceChildren();
  }

  const firstTailNode = tail?.firstChild ?? null;
  if (tail && firstTailNode) container.appendChild(tail);

  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (firstTailNode) {
    // Caret at the very start of the moved tail (before the marker is not
    // possible: setStartBefore anchors relative to the tail's first node).
    range.setStartBefore(firstTailNode);
  } else {
    const zws = document.createTextNode(ZERO_WIDTH_SPACE);
    container.appendChild(zws);
    range.setStart(zws, ZERO_WIDTH_SPACE.length);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Insert a new list item after the caret's current row. Content after the caret
 * moves into the new row (with inline formatting preserved); the marker glyph is
 * preserved on both rows. Returns false when the caret isn't inside a direct row
 * of the list so the caller can fall back.
 */
export function insertBulletAfterCaret(list: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) {
    // A selection that spans a row's marker glyph would delete it here, blanking
    // the bullet on the surviving row (and its clone). Clamp both boundaries out
    // of any enclosing marker so deletion never touches the glyphs.
    const startMarker = enclosingMarker(range.startContainer, list);
    if (startMarker) range.setStartAfter(startMarker);
    const endMarker = enclosingMarker(range.endContainer, list);
    if (endMarker) range.setEndBefore(endMarker);
    if (!range.collapsed) range.deleteContents();
  }

  let row: HTMLElement | null = null;
  let node: Node | null = range.endContainer;
  while (node && node !== list) {
    if (node.parentNode === list) {
      row = node as HTMLElement;
      break;
    }
    node = node.parentNode;
  }
  if (!row) return false;

  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;

  // Never split inside the marker glyph itself: a caret at offset 0 of the "●"
  // text node (e.g. clicking the marker's leading edge) would otherwise blank
  // the marker and un-bullet the row. In that case add an empty bullet instead.
  const caretInMarker = !!marker && marker.contains(range.endContainer);

  const container = rowTextContainer(row, marker);
  let tail: DocumentFragment | null = null;
  if (!caretInMarker && container.contains(range.endContainer)) {
    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    const lastChild = container.lastChild;
    if (lastChild) tailRange.setEndAfter(lastChild);
    else tailRange.setEnd(container, container.childNodes.length);
    // extractContents() moves the trailing DOM subtree (preserving <strong>/
    // <em>) out of the original row so it can be reparented into the new one.
    tail = tailRange.extractContents();
    // A caret at the very end of the text (the common case) makes tailRange
    // collapsed, but extractContents() on a collapsed range still clones the
    // boundary text node with empty data instead of returning an empty
    // fragment. Treat that as "no tail" so primeNewRow falls through to the
    // zero-width-space placeholder — otherwise it moves in an empty text node
    // with no character to anchor the caret's font to, and typing falls back
    // to the marker span's formatting instead of the text span's.
    if (tail.textContent === "") tail = null;
  }

  const newRow = row.cloneNode(true) as HTMLElement;
  for (const el of [newRow, ...Array.from(newRow.querySelectorAll("*"))]) {
    el.removeAttribute("data-builder-id");
    el.removeAttribute("data-fusion-element-id");
  }
  row.after(newRow);
  primeNewRow(newRow, tail);
  return true;
}
