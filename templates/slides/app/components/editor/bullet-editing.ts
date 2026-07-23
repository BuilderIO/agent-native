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

/** True if an element is just a bullet marker glyph (e.g. a leading ● span). */
export function isBulletMarker(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  return text.length > 0 && [...text].every((c) => BULLET_GLYPHS.has(c));
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

/**
 * Seed a freshly-inserted row with the given tail text and place the caret at
 * the start of its editable text. The text is written into a real text node
 * inside the row's non-marker text span so typed characters inherit the row's
 * font size (an empty inline span would drop the caret to the container).
 */
function primeNewRow(row: HTMLElement, tail: string): void {
  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;
  const textSpan = Array.from(row.children).find(
    (c) => c.tagName === "SPAN" && c !== marker && !isBulletMarker(c),
  ) as HTMLElement | undefined;

  const initial = tail.length > 0 ? tail : ZERO_WIDTH_SPACE;
  const textNode = document.createTextNode(initial);

  if (textSpan) {
    // Reset only the text span; the marker span is a sibling and is preserved.
    textSpan.replaceChildren(textNode);
  } else {
    // No dedicated text span (text is a bare node): keep the marker, drop
    // everything after it, then append the fresh text so it inherits the row.
    while (marker?.nextSibling) marker.nextSibling.remove();
    if (!marker) row.replaceChildren();
    row.appendChild(textNode);
  }

  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(textNode, tail.length > 0 ? 0 : ZERO_WIDTH_SPACE.length);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Insert a new list item after the caret's current row. Text after the caret
 * moves into the new row; the marker glyph is preserved. Returns false when
 * the caret isn't inside a direct row of the list so the caller can fall back.
 */
export function insertBulletAfterCaret(list: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) range.deleteContents();

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

  let tail = "";
  const caretNode = range.endContainer;
  if (caretNode.nodeType === Node.TEXT_NODE) {
    const full = caretNode.textContent ?? "";
    tail = full.slice(range.endOffset);
    caretNode.textContent = full.slice(0, range.endOffset);
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
