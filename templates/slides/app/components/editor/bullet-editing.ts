export const ZERO_WIDTH_SPACE = "\u200B";

export function stripCopiedIdentity(root: Element) {
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    stripIdentity(element);
  }
}

function stripIdentity(element: Element) {
  for (const { name } of Array.from(element.attributes)) {
    if (name === "id" || /^data-.+-id$/.test(name)) {
      element.removeAttribute(name);
    }
  }
}

export function extractWithoutCopiedIdentity(range: Range): DocumentFragment {
  const common = range.commonAncestorContainer;
  const copiedDepth = (node: Node) => {
    let depth = 0;
    for (let at: Node | null = node; at && at !== common; at = at.parentNode) {
      if (at instanceof Element) depth += 1;
    }
    return depth;
  };
  const startDepth = copiedDepth(range.startContainer);
  const endDepth = copiedDepth(range.endContainer);
  const fragment = range.extractContents();
  let copy = fragment.firstChild;
  for (let left = startDepth; left > 0 && copy instanceof Element; left -= 1) {
    stripIdentity(copy);
    copy = copy.firstChild;
  }
  copy = fragment.lastChild;
  for (let left = endDepth; left > 0 && copy instanceof Element; left -= 1) {
    stripIdentity(copy);
    copy = copy.lastChild;
  }
  return fragment;
}

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

export function isBulletMarker(el: Element): boolean {
  return isGlyphMarker(el) || isShapeMarker(el);
}

function isGlyphMarker(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  return text.length > 0 && Array.from(text).every((c) => BULLET_GLYPHS.has(c));
}

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

export function isBulletRow(el: HTMLElement): boolean {
  if (el.tagName !== "DIV" && el.tagName !== "LI" && el.tagName !== "P") {
    return false;
  }
  const first = el.firstElementChild;
  return !!first && isBulletMarker(first);
}

export function bulletRowCount(el: HTMLElement): number {
  return Array.from(el.children).filter((k) => isBulletRow(k as HTMLElement))
    .length;
}

export function isBulletList(el: HTMLElement): boolean {
  const kids = Array.from(el.children);
  if (kids.length === 0) return false;
  const rows = bulletRowCount(el);
  return rows >= 1 && rows >= kids.length - 1;
}

const MARKDOWN_BULLET_PREFIX = /^[-*] $/;

export function convertMarkdownPrefixToBullet(el: HTMLElement): boolean {
  if (isBulletRow(el) || isBulletList(el)) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const caretRange = sel.getRangeAt(0);
  if (!caretRange.collapsed) return false;

  const beforeCaretRange = document.createRange();
  beforeCaretRange.selectNodeContents(el);
  beforeCaretRange.setEnd(caretRange.endContainer, caretRange.endOffset);
  const beforeCaretText = beforeCaretRange
    .toString()
    .replace(new RegExp(ZERO_WIDTH_SPACE, "g"), "");
  if (!MARKDOWN_BULLET_PREFIX.test(beforeCaretText)) return false;
  beforeCaretRange.deleteContents();

  const marker = document.createElement("span");
  marker.style.fontSize = "0.3em";
  marker.style.position = "relative";
  marker.style.top = "-0.15em";
  marker.textContent = "\u25CF";

  const textSpan = document.createElement("span");
  while (el.firstChild) textSpan.appendChild(el.firstChild);
  const restFirstChild = textSpan.firstChild;
  let placeholderZws: Text | null = null;
  if (!restFirstChild) {
    placeholderZws = document.createTextNode(ZERO_WIDTH_SPACE);
    textSpan.appendChild(placeholderZws);
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
    range.setStart(placeholderZws as Text, ZERO_WIDTH_SPACE.length);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function findEnclosingList(
  el: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && root.contains(node)) {
    const parentEl: HTMLElement | null = node.parentElement;
    if (!parentEl) break;
    if (
      node.tagName === "LI" &&
      (parentEl.tagName === "UL" || parentEl.tagName === "OL")
    ) {
      return parentEl;
    }
    if (isBulletRow(node) && isBulletList(parentEl)) return parentEl;
    if (isBulletRow(node) && bulletRowCount(parentEl) >= 2) return parentEl;
    node = parentEl;
  }
  return null;
}

export function rowTextContainer(
  row: HTMLElement,
  marker: HTMLElement | null,
): HTMLElement {
  const textSpan = Array.from(row.children).find(
    (c) => c.tagName === "SPAN" && c !== marker && !isBulletMarker(c),
  ) as HTMLElement | undefined;
  return textSpan ?? row;
}

function listRows(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter((child) => {
    const element = child as HTMLElement;
    return element.tagName === "LI" || isBulletRow(element);
  }) as HTMLElement[];
}

function isNativeListItem(row: HTMLElement): boolean {
  const parentTag = row.parentElement?.tagName;
  return row.tagName === "LI" && (parentTag === "UL" || parentTag === "OL");
}

function hasNonPlaceholderElement(element: Element): boolean {
  if (element.tagName === "BR") return false;
  if (element.children.length === 0) {
    return element.tagName !== "SPAN";
  }
  return Array.from(element.children).some(hasNonPlaceholderElement);
}

function hasMeaningfulContent(nodes: Node[]): boolean {
  return nodes.some((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.replaceAll(ZERO_WIDTH_SPACE, "").trim() !== "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as Element;
    return (
      element.textContent?.replaceAll(ZERO_WIDTH_SPACE, "").trim() !== "" ||
      hasNonPlaceholderElement(element)
    );
  });
}

function selectedEmptyBulletRow(list: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  let row: HTMLElement | null = null;
  while (node && node !== list) {
    if (node.parentNode === list && node.nodeType === Node.ELEMENT_NODE) {
      const candidate = node as HTMLElement;
      if (candidate.tagName === "LI" || isBulletRow(candidate)) row = candidate;
      break;
    }
    node = node.parentNode;
  }
  if (!row) return null;

  if (isNativeListItem(row)) {
    return hasMeaningfulContent(Array.from(row.childNodes)) ? null : row;
  }

  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;
  if (marker?.contains(range.startContainer)) return null;
  const textContainer = rowTextContainer(row, marker);
  if (
    range.startContainer !== row &&
    !textContainer.contains(range.startContainer)
  ) {
    return null;
  }
  const text =
    textContainer === row
      ? Array.from(row.childNodes)
          .filter((child) => child !== marker)
          .map((child) => child.textContent ?? "")
          .join("")
      : (textContainer.textContent ?? "");
  if (text.replaceAll(ZERO_WIDTH_SPACE, "").trim() !== "") return null;
  return hasMeaningfulContent(
    Array.from(row.childNodes).filter((child) => child !== marker),
  )
    ? null
    : row;
}

function setCaretAtRowBoundary(row: HTMLElement, atEnd: boolean): void {
  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;
  const textContainer = rowTextContainer(row, marker);
  const range = document.createRange();
  const textWalker = document.createTreeWalker(
    textContainer,
    NodeFilter.SHOW_TEXT,
  );
  let firstText: Text | null = null;
  let lastText: Text | null = null;
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
    if (marker?.contains(node)) continue;
    firstText ??= node as Text;
    lastText = node as Text;
  }
  const textNode = atEnd ? lastText : firstText;
  if (textNode) {
    range.setStart(textNode, atEnd ? textNode.data.length : 0);
    range.collapse(true);
  } else if (textContainer !== row) {
    range.selectNodeContents(textContainer);
    range.collapse(!atEnd);
  } else if (atEnd) {
    range.selectNodeContents(row);
    range.collapse(false);
  } else if (marker) {
    range.setStartAfter(marker);
    range.collapse(true);
  } else {
    range.selectNodeContents(row);
    range.collapse(true);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function setCaretAtContainerBoundary(container: Node, atEnd: boolean): void {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(!atEnd);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function isMeaningfulNode(node: Node): boolean {
  return hasMeaningfulContent([node]);
}

function hasBulletRow(nodes: Node[]): boolean {
  return nodes.some(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).tagName === "LI" ||
        isBulletRow(node as HTMLElement)),
  );
}

function effectiveOrderedListStart(
  list: HTMLElement,
  rowCount: number,
): number {
  const parsedStart = Number.parseInt(list.getAttribute("start") ?? "", 10);
  if (Number.isFinite(parsedStart)) return parsedStart;
  return list.hasAttribute("reversed") ? rowCount : 1;
}

function orderedListContinuation(
  list: HTMLElement,
  rows: HTMLElement[],
  rowIndex: number,
): number {
  let value = effectiveOrderedListStart(list, rows.length);
  const step = list.hasAttribute("reversed") ? -1 : 1;
  for (let index = 0; index <= rowIndex; index++) {
    const override = Number.parseInt(
      rows[index].getAttribute("value") ?? "",
      10,
    );
    if (Number.isFinite(override)) value = override;
    value += step;
  }
  return value;
}

function listWithNodes(
  list: HTMLElement,
  nodes: Node[],
  orderedStart?: number,
): HTMLElement {
  const clone = list.cloneNode(false) as HTMLElement;
  stripCopiedIdentity(clone);
  clone.removeAttribute("contenteditable");
  clone.removeAttribute("data-editing-block");
  if (orderedStart !== undefined) {
    clone.setAttribute("start", String(orderedStart));
  }
  clone.replaceChildren(...nodes);
  return clone;
}

function createRootLine(
  list: HTMLElement,
  row: HTMLElement,
): HTMLElement | null {
  const parent = list.parentElement;
  if (!parent) return null;

  const line = list.ownerDocument.createElement("div");
  line.style.cssText = list.style.cssText;
  for (let i = 0; i < row.style.length; i++) {
    const property = row.style.item(i);
    line.style.setProperty(
      property,
      row.style.getPropertyValue(property),
      row.style.getPropertyPriority(property),
    );
  }
  for (const property of [
    "display",
    "flex-direction",
    "flex-wrap",
    "align-items",
    "justify-content",
    "gap",
    "list-style",
    "list-style-position",
    "list-style-type",
    "padding-left",
  ]) {
    line.style.removeProperty(property);
  }

  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;
  const textContainer = rowTextContainer(row, marker);
  if (textContainer !== row) {
    const text = textContainer.cloneNode(false) as HTMLElement;
    stripCopiedIdentity(text);
    text.replaceChildren(list.ownerDocument.createTextNode(ZERO_WIDTH_SPACE));
    line.appendChild(text);
  } else {
    line.appendChild(list.ownerDocument.createTextNode(ZERO_WIDTH_SPACE));
  }
  return line;
}

export function removeEmptyBulletAtCaret(
  list: HTMLElement,
): { handled: true; editingElement: HTMLElement | null } | null {
  const row = selectedEmptyBulletRow(list);
  if (!row) return null;

  const rows = listRows(list);
  const rowIndex = rows.indexOf(row);
  if (rowIndex < 0) return null;
  if (rows.length === 1) {
    const remainingNodes = Array.from(list.childNodes).filter(
      (node) => node !== row,
    );
    if (remainingNodes.some(isMeaningfulNode)) {
      const placeAtEnd = !!row.previousElementSibling;
      row.remove();
      setCaretAtContainerBoundary(list, placeAtEnd);
      return { handled: true, editingElement: null };
    }
    const line = createRootLine(list, row);
    if (!line) return null;
    list.replaceWith(line);
    setCaretAtRowBoundary(line, false);
    return { handled: true, editingElement: line };
  }

  const previous = rows[rowIndex - 1];
  const next = rows[rowIndex + 1];
  const parsedStart = Number.parseInt(list.getAttribute("start") ?? "", 10);
  const implicitReversedStart =
    list.tagName === "OL" &&
    list.hasAttribute("reversed") &&
    !Number.isFinite(parsedStart)
      ? effectiveOrderedListStart(list, rows.length)
      : null;
  row.remove();
  if (implicitReversedStart !== null) {
    list.setAttribute("start", String(implicitReversedStart));
  }
  setCaretAtRowBoundary(previous ?? next, Boolean(previous));
  return { handled: true, editingElement: null };
}

export function exitEmptyBulletAtCaret(list: HTMLElement): HTMLElement | null {
  const row = selectedEmptyBulletRow(list);
  if (!row) return null;
  const line = createRootLine(list, row);
  if (!line) return null;

  const childNodes = Array.from(list.childNodes);
  const rowIndex = childNodes.indexOf(row);
  if (rowIndex < 0) return null;
  const beforeNodes = childNodes.slice(0, rowIndex);
  const afterNodes = childNodes.slice(rowIndex + 1);
  const beforeHasRows = hasBulletRow(beforeNodes);
  const afterHasRows = hasBulletRow(afterNodes);
  const rows = listRows(list);
  const rowIndexInList = rows.indexOf(row);
  const orderedStart =
    list.tagName === "OL" ? effectiveOrderedListStart(list, rows.length) : null;
  const trailingStart =
    orderedStart !== null && rowIndexInList >= 0
      ? orderedListContinuation(list, rows, rowIndexInList)
      : undefined;

  if (beforeHasRows) {
    list.replaceChildren(...beforeNodes);
    if (list.hasAttribute("reversed") && orderedStart !== null) {
      list.setAttribute("start", String(orderedStart));
    }
    if (afterHasRows) {
      list.after(line, listWithNodes(list, afterNodes, trailingStart));
    } else {
      const following = list.ownerDocument.createDocumentFragment();
      following.append(line, ...afterNodes);
      list.after(following);
    }
  } else if (afterHasRows) {
    list.replaceChildren(...afterNodes);
    if (trailingStart !== undefined) {
      list.setAttribute("start", String(trailingStart));
    }
    const preceding = list.ownerDocument.createDocumentFragment();
    preceding.append(...beforeNodes, line);
    list.before(preceding);
  } else if (
    beforeNodes.some(isMeaningfulNode) ||
    afterNodes.some(isMeaningfulNode)
  ) {
    const replacement = list.ownerDocument.createDocumentFragment();
    replacement.append(...beforeNodes, line, ...afterNodes);
    list.replaceWith(replacement);
  } else {
    list.replaceWith(line);
  }
  setCaretAtRowBoundary(line, false);
  return line;
}

function primeNewRow(row: HTMLElement, tail: DocumentFragment | null): void {
  const marker =
    row.firstElementChild && isBulletMarker(row.firstElementChild)
      ? (row.firstElementChild as HTMLElement)
      : null;
  const container = rowTextContainer(row, marker);

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

export function insertBulletAfterCaret(list: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) {
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

  const caretInMarker = !!marker && marker.contains(range.endContainer);

  const container = rowTextContainer(row, marker);
  let tail: DocumentFragment | null = null;
  if (!caretInMarker && container.contains(range.endContainer)) {
    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    const lastChild = container.lastChild;
    if (lastChild) tailRange.setEndAfter(lastChild);
    else tailRange.setEnd(container, container.childNodes.length);
    tail = extractWithoutCopiedIdentity(tailRange);
    if (tail.textContent === "") tail = null;
  }

  const newRow = row.cloneNode(true) as HTMLElement;
  stripCopiedIdentity(newRow);
  row.after(newRow);
  primeNewRow(newRow, tail);
  return true;
}
