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
