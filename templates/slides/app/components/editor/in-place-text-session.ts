/**
 * In-place text editing for one slide element. The element itself becomes
 * contentEditable, with no wrapper, copy, or visibility change, so entering
 * edit changes nothing on the slide. Chrome's own editing commands restyle and
 * restructure text (a computed-style span on Backspace, a new DIV on Enter,
 * `<b>` on Cmd+B), so only typing inside one existing text node is left to the
 * browser; every other input is performed here.
 */

import {
  convertMarkdownPrefixToBullet,
  extractWithoutCopiedIdentity,
  findEnclosingList,
  insertBulletAfterCaret,
  isBulletMarker,
  isBulletRow,
  removeEmptyBulletAtCaret,
  rowTextContainer,
  stripCopiedIdentity,
  ZERO_WIDTH_SPACE,
} from "./bullet-editing";
import {
  createSlideList,
  type SlideListKind,
  toggleSlideList,
} from "./list-editing";
import {
  applyInlineTextStyle,
  type InlineTextFormat,
  type InlineTextStyleApplication,
  type InlineTextStylePatch,
  normalizeSlideClipboardHtml,
  selectAllEditableText,
  setInlineTextLink,
  toggleInlineTextFormat,
} from "./rich-text-selection";

export interface InPlaceTextSessionOptions {
  /** Viewport point of the click that started editing; the caret lands there. */
  caretPoint?: { x: number; y: number } | null;
  /** Called after every change to the edited content. */
  onInput?: () => void;
}

export type SlideTextAlign = "left" | "center" | "right" | "justify";

export interface InPlaceTextSessionCommands {
  bold: () => boolean;
  italic: () => boolean;
  underline: () => boolean;
  strike: () => boolean;
  color: (value: string) => boolean;
  fontSize: (value: string) => boolean;
  fontFamily: (value: string) => boolean;
  textStyle: (patch: InlineTextStylePatch) => boolean;
  /** Links the selected text; `null` unlinks it. */
  link: (href: string | null) => boolean;
  align: (value: SlideTextAlign) => boolean;
  toggleList: (kind: SlideListKind) => boolean;
}

export interface InPlaceTextSession {
  /** The edited element. `toggleList` and undo can replace it with a retag. */
  readonly element: HTMLElement;
  readonly isActive: boolean;
  /**
   * False while the edit's net effect is invisible (typed and deleted back),
   * which is exactly when `end()` restores the start bytes.
   */
  readonly changed: boolean;
  readonly commands: InPlaceTextSessionCommands;
  /** Runs a change to the edited element itself (a dock style) as one undo step. */
  apply: (mutate: () => void) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /**
   * A copy of `root` (the element's slide) as content: without the caret
   * placeholders this session added, and with the author's own zero-width
   * spaces, which only the session can tell apart.
   */
  cloneWithoutPlaceholders: (root: HTMLElement) => HTMLElement;
  /** Settles placeholders and restores the element's pre-session attributes. */
  end: () => void;
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** Blocks that Enter never splits and Backspace never merges. */
const STRUCTURAL_BLOCK_TAGS = new Set([
  "DL",
  "OL",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

const RENDERED_ELEMENTS =
  "br, img, svg, video, canvas, picture, iframe, input, hr";
/** Blocks whose content may include a list, so a pasted list stays one. */
const LIST_HOLDER_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "HEADER",
  "SECTION",
  "TD",
  "TH",
]);
const PASTE_INLINE_TAGS = new Set([
  "A",
  "B",
  "BR",
  "EM",
  "I",
  "S",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "U",
]);
const SAFE_LINK = /^(https?:|mailto:)/i;
/**
 * Chrome copies a page's computed style onto each run (background, display,
 * custom properties, `orphans`); pasting keeps only text formatting.
 */
const PASTE_STYLE_PROPERTY =
  /^(color|font(-.+)?|text-decoration(-.+)?|letter-spacing|word-spacing|text-transform|vertical-align)$/;
const PLACEHOLDER_ONLY = new RegExp(`^${ZERO_WIDTH_SPACE}+$`);
const UNDO_LIMIT = 100;
/** How far Tab nests a legacy bullet row, the way generated decks draw sub-bullets. */
const LEGACY_ROW_INDENT_PX = 24;
const TYPING_RUN_MS = 1000;

type DeleteDirection = "backward" | "forward";

const DELETE_STEPS: Record<string, [DeleteDirection, string]> = {
  deleteContentBackward: ["backward", "character"],
  deleteContentForward: ["forward", "character"],
  deleteWordBackward: ["backward", "word"],
  deleteWordForward: ["forward", "word"],
  deleteSoftLineBackward: ["backward", "lineboundary"],
  deleteSoftLineForward: ["forward", "lineboundary"],
  deleteHardLineBackward: ["backward", "paragraphboundary"],
  deleteHardLineForward: ["forward", "paragraphboundary"],
};

const FORMAT_INPUTS: Record<string, InlineTextFormat> = {
  formatBold: "bold",
  formatItalic: "italic",
  formatUnderline: "underline",
  formatStrikeThrough: "strike",
};

const ALIGN_INPUTS: Record<string, SlideTextAlign> = {
  formatJustifyLeft: "left",
  formatJustifyCenter: "center",
  formatJustifyRight: "right",
  formatJustifyFull: "justify",
};

const PASTE_INPUTS = new Set([
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertFromDrop",
  "insertFromYank",
]);

const COMPOSITION_INPUTS = new Set([
  "insertCompositionText",
  "deleteCompositionText",
  "insertFromComposition",
]);

type EditKind = "typing" | "delete" | "command";

/** A selection as text offsets; `*Before` keeps an edge on the text it ends. */
interface TextOffsets {
  from: number;
  to: number;
  fromBefore: boolean;
  toBefore: boolean;
}

interface Snapshot extends TextOffsets {
  tag: string;
  attributes: [string, string][];
  html: string;
  /** Text offsets of the author's zero-width-space nodes. */
  authorZwsp: number[];
}

/** One pasted line and the UL/OL tags it was nested in, outermost first. */
interface PastedLine {
  fragment: DocumentFragment;
  lists: readonly string[];
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function textNodesIn(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node as Text);
  }
  return texts;
}

function laysOutOwnLines(element: Element) {
  const display = window.getComputedStyle(element).display;
  // A DOM without layout (happy-dom) leaves inline defaults unresolved.
  if (!display) return BLOCK_TAGS.has(element.tagName);
  return (
    display !== "contents" &&
    display !== "none" &&
    !display.startsWith("inline")
  );
}

/** A block Enter can split and Backspace can merge. */
function isBlock(element: Element) {
  return BLOCK_TAGS.has(element.tagName) && laysOutOwnLines(element);
}

function nearestBlock(node: Node, root: HTMLElement): HTMLElement {
  for (
    let element = node instanceof HTMLElement ? node : node.parentElement;
    element && element !== root && root.contains(element);
    element = element.parentElement
  ) {
    if (isBlock(element)) return element;
  }
  return root;
}

/**
 * The box whose lines `node` sits on. A flex or grid item is blockified, so a
 * marker `<span>` in a flex bullet row is its own line box: the text in the
 * next item never continues its line.
 */
function nearestLineBox(node: Node, root: HTMLElement): HTMLElement {
  for (
    let element = node instanceof HTMLElement ? node : node.parentElement;
    element && element !== root && root.contains(element);
    element = element.parentElement
  ) {
    if (laysOutOwnLines(element)) return element;
  }
  return root;
}

function hasRenderedContent(node: Node): boolean {
  if (node.textContent?.replaceAll(ZERO_WIDTH_SPACE, "").trim()) return true;
  return (
    (node instanceof Element || node instanceof DocumentFragment) &&
    node.querySelector(RENDERED_ELEMENTS) !== null
  );
}

function renderedAfter(node: Node, block: HTMLElement) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.setEnd(block, block.childNodes.length);
  return hasRenderedContent(range.cloneContents());
}

/** What follows `node` on its own line: up to the next box that starts a line. */
function lineRest(node: Node, line: HTMLElement): DocumentFragment {
  const rest = document.createRange();
  rest.setStartAfter(node);
  rest.setEnd(line, line.childNodes.length);
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = node;
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    if (laysOutOwnLines(next as Element)) {
      rest.setEndBefore(next);
      break;
    }
  }
  return rest.cloneContents();
}

/** What the nearest rendered thing before `node` inside `block` is. */
function renderedBefore(
  node: Node,
  block: HTMLElement,
): "br" | "none" | "content" {
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEndBefore(node);
  const walker = document.createTreeWalker(
    range.cloneContents(),
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let last: "br" | "none" | "content" = "none";
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current instanceof Element) {
      if (current.matches(RENDERED_ELEMENTS)) {
        last = current.tagName === "BR" ? "br" : "content";
      }
    } else if (hasRenderedContent(current)) {
      last = "content";
    }
  }
  return last;
}

function placeCaret(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Characters before a point in `root`. With `breaks`, each `<br>` counts as
 * one, so a caret between two `<br>`s keeps its line; a count that must
 * survive `<br>`s turning into items (a list toggle) leaves them out.
 */
function textOffset(
  root: HTMLElement,
  node: Node,
  offset: number,
  breaks = false,
) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  let count = range.toString().length;
  if (breaks) {
    for (const br of Array.from(root.querySelectorAll("br"))) {
      const index = Array.from(br.parentNode!.childNodes).indexOf(br);
      if (range.comparePoint(br.parentNode!, index + 1) === 0) count += 1;
    }
  }
  return count;
}

/**
 * The text position `offset` characters into `root`, counted as `textOffset`
 * counts them. Where two text nodes meet, `before` keeps the end of the
 * earlier one, so a caret at the end of an item stays there; otherwise the
 * later one wins, so a caret after <br> does.
 */
function textPoint(
  root: Node,
  offset: number,
  before = false,
  breaks = false,
): [Node, number] {
  let remaining = offset;
  let last: Text | null = null;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (breaks && node instanceof HTMLBRElement) {
      if (remaining === 0) {
        return [
          node.parentNode!,
          Array.from(node.parentNode!.childNodes).indexOf(node),
        ];
      }
      remaining -= 1;
      continue;
    }
    if (!(node instanceof Text)) continue;
    if (
      remaining < node.length ||
      (before && node.length > 0 && remaining === node.length)
    ) {
      return [node, remaining];
    }
    remaining -= node.length;
    last = node;
  }
  return last ? [last, last.length] : [root, root.childNodes.length];
}

/** Whether a boundary point ends the text before it, for `textPoint`'s `before`. */
function endsText(node: Node, offset: number): boolean {
  if (node instanceof Text) return offset > 0;
  let previous: Node | null = node.childNodes[offset - 1] ?? null;
  while (
    previous instanceof Element &&
    !previous.matches(RENDERED_ELEMENTS) &&
    previous.lastChild
  ) {
    previous = previous.lastChild;
  }
  return previous instanceof Text && previous.length > 0;
}

function caretFromPoint(point: {
  x: number;
  y: number;
}): [Node, number] | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(point.x, point.y);
  if (position) return [position.offsetNode, position.offset];
  const range = doc.caretRangeFromPoint?.(point.x, point.y);
  return range ? [range.startContainer, range.startOffset] : null;
}

function graphemeAt(data: string, offset: number, backward: boolean) {
  for (const { index, segment } of graphemes.segment(data)) {
    if (backward ? index + segment.length === offset : index === offset) {
      return segment;
    }
  }
  return null;
}

function retag(element: HTMLElement, tagName: string): HTMLElement {
  const next = document.createElement(tagName);
  for (const attribute of Array.from(element.attributes)) {
    next.setAttribute(attribute.name, attribute.value);
  }
  next.append(...Array.from(element.childNodes));
  element.replaceWith(next);
  return next;
}

function rowMarker(row: HTMLElement): HTMLElement | null {
  const first = row.firstElementChild;
  return first instanceof HTMLElement && isBulletMarker(first) ? first : null;
}

function isEmptyRow(row: HTMLElement) {
  const marker = rowMarker(row);
  return !Array.from(row.childNodes).some(
    (child) => child !== marker && hasRenderedContent(child),
  );
}

function legacyRows(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && isBulletRow(child),
  );
}

function appendPastedNode(node: Node, target: Node) {
  if (node instanceof Text) {
    target.appendChild(document.createTextNode(node.data));
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  let into = target;
  if (PASTE_INLINE_TAGS.has(node.tagName)) {
    const copy = document.createElement(node.tagName);
    for (let index = 0; index < node.style.length; index += 1) {
      const name = node.style.item(index);
      if (!PASTE_STYLE_PROPERTY.test(name)) continue;
      copy.style.setProperty(
        name,
        node.style.getPropertyValue(name),
        node.style.getPropertyPriority(name),
      );
    }
    const href = node.getAttribute("href");
    if (node.tagName === "A" && href && SAFE_LINK.test(href.trim())) {
      copy.setAttribute("href", href);
    }
    target.appendChild(copy);
    into = copy;
  }
  for (const child of Array.from(node.childNodes)) {
    appendPastedNode(child, into);
  }
}

/**
 * Pasted HTML as inline lines: each block becomes its own line, inline text
 * formatting keeps only its `style` (and a safe `href`), and every other
 * element is unwrapped, so pasting can never bring in layout or classes.
 */
function pastedHtmlLines(html: string): PastedLine[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const lines: PastedLine[] = [];
  const collect = (parent: Node, lists: readonly string[]) => {
    let line: PastedLine | null = null;
    for (const child of Array.from(parent.childNodes)) {
      if (child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName)) {
        line = null;
        const list = child.tagName === "UL" || child.tagName === "OL";
        collect(child, list ? [...lists, child.tagName] : lists);
        continue;
      }
      if (!line) {
        if (child instanceof Text && !child.data.trim()) continue;
        line = { fragment: document.createDocumentFragment(), lists };
        lines.push(line);
      }
      appendPastedNode(child, line.fragment);
    }
  };
  collect(template.content, []);
  for (const { fragment } of lines) {
    if (fragment.lastChild instanceof HTMLBRElement) {
      fragment.lastChild.remove();
    }
  }
  return lines;
}

function plainTextLines(text: string): PastedLine[] {
  return text.split(/\r\n|\r|\n/).map((line) => {
    const fragment = document.createDocumentFragment();
    if (line) fragment.append(line);
    return { fragment, lists: [] };
  });
}

/** Pasted list lines as one list, nested the way they were. */
function pastedList(lines: PastedLine[]): HTMLElement {
  const open: HTMLElement[] = [];
  for (const { fragment, lists } of lines) {
    open.length = Math.min(open.length, lists.length);
    while (open.length < lists.length) {
      const list = createSlideList(
        document,
        lists[open.length] === "OL" ? "ordered" : "bullet",
      );
      const parent = open[open.length - 1];
      if (parent) {
        (
          parent.lastElementChild ??
          parent.appendChild(document.createElement("li"))
        ).append(list);
      }
      open.push(list);
    }
    const item = document.createElement("li");
    item.append(fragment);
    open[open.length - 1].append(item);
  }
  return open[0];
}

/**
 * Makes `element` editable in place and returns the session that owns every
 * edit to it until `end()`. Only `contenteditable` and `data-editing-block`
 * change on the element; with no input, `end()` leaves its markup identical.
 */
export function startInPlaceTextSession(
  element: HTMLElement,
  options: InPlaceTextSessionOptions = {},
): InPlaceTextSession {
  if (element.isContentEditable) {
    throw new Error("startInPlaceTextSession: element is already editable");
  }
  let el = element;
  let active = true;
  const initialContentEditable = el.getAttribute("contenteditable");
  const initialEditingBlock = el.getAttribute("data-editing-block");
  const startHtml = el.innerHTML;
  const startText = el.innerText;
  // An author ZWSP is told apart from a placeholder by its text node. An
  // undo rebuilds the nodes from HTML, so snapshots carry them by position.
  const authorZwsp = new WeakSet<Text>(
    textNodesIn(el).filter((text) => text.data.includes(ZERO_WIDTH_SPACE)),
  );
  const undoStack: Snapshot[] = [];
  const redoStack: Snapshot[] = [];
  let lastEdit: { kind: EditKind; at: number; boundary: boolean } | null = null;
  let edited = false;
  /** A drag-move's deletion, which its drop joins into one undo step. */
  let dragDeleted = false;
  // Script can still scroll an overflow:hidden ancestor, and Chrome does, to
  // reveal a caret in text the slide clips; that slides the whole slide
  // under the edit. Their offsets stay pinned for the session.
  const pinnedScroll: [Element, number, number][] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const { overflow, overflowX, overflowY } = window.getComputedStyle(node);
    if ([overflow, overflowX, overflowY].includes("hidden")) {
      pinnedScroll.push([node, node.scrollTop, node.scrollLeft]);
    }
  }
  function unscroll() {
    for (const [node, top, left] of pinnedScroll) {
      if (node.scrollTop !== top) node.scrollTop = top;
      if (node.scrollLeft !== left) node.scrollLeft = left;
    }
  }

  const notify = () => {
    unscroll();
    options.onInput?.();
  };

  function selectionRange(): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    return el.contains(range.startContainer) && el.contains(range.endContainer)
      ? range
      : null;
  }

  function selectionOffsets(breaks = false): TextOffsets {
    const range = selectionRange();
    if (!range) return { from: 0, to: 0, fromBefore: false, toBefore: false };
    const { startContainer, startOffset, endContainer, endOffset } = range;
    return {
      from: textOffset(el, startContainer, startOffset, breaks),
      to: textOffset(el, endContainer, endOffset, breaks),
      fromBefore: endsText(startContainer, startOffset),
      toBefore: endsText(endContainer, endOffset),
    };
  }

  function select(
    start: readonly [Node, number],
    end: readonly [Node, number],
  ) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function selectOffsets(
    { from, to, fromBefore, toBefore }: TextOffsets,
    breaks = false,
  ) {
    select(
      textPoint(el, from, fromBefore, breaks),
      textPoint(el, to, toBefore, breaks),
    );
  }

  /**
   * Runs a change that moves or rebuilds the text, keeping the selection on
   * the same characters: on the same text nodes when they were only moved,
   * by text offsets when they were rebuilt.
   */
  function keepingSelection(mutate: () => boolean): boolean {
    const range = selectionRange();
    const points = range
      ? ([
          [range.startContainer, range.startOffset],
          [range.endContainer, range.endOffset],
        ] as const)
      : null;
    const offsets = selectionOffsets();
    if (!mutate()) return false;
    const intact = points?.every(
      ([node, offset]) =>
        node instanceof Text && el.contains(node) && offset <= node.length,
    );
    if (points && intact) select(points[0], points[1]);
    else selectOffsets(offsets);
    return true;
  }

  function snapshot(): Snapshot {
    return {
      tag: el.tagName,
      attributes: Array.from(el.attributes, (attribute): [string, string] => [
        attribute.name,
        attribute.value,
      ]),
      html: el.innerHTML,
      authorZwsp: authorZwspOffsets(),
      ...selectionOffsets(true),
    };
  }

  function authorZwspOffsets(): number[] {
    const offsets: number[] = [];
    let at = 0;
    for (const text of textNodesIn(el)) {
      if (authorZwsp.has(text)) offsets.push(at);
      at += text.length;
    }
    return offsets;
  }

  function restore(state: Snapshot) {
    if (el.tagName !== state.tag) rebind(retag(el, state.tag));
    for (const attribute of Array.from(el.attributes)) {
      if (!state.attributes.some(([name]) => name === attribute.name)) {
        el.removeAttribute(attribute.name);
      }
    }
    for (const [name, value] of state.attributes) {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
    el.innerHTML = state.html;
    let at = 0;
    for (const text of textNodesIn(el)) {
      const end = at + text.length;
      if (state.authorZwsp.some((offset) => offset >= at && offset < end)) {
        authorZwsp.add(text);
      }
      at = end;
    }
    selectOffsets(state, true);
  }

  /** Records the pre-change state; a run of typing or deleting is one step. */
  function checkpoint(kind: EditKind, boundary = false) {
    edited = true;
    const now = Date.now();
    const coalesce =
      kind !== "command" &&
      lastEdit?.kind === kind &&
      !lastEdit.boundary &&
      now - lastEdit.at < TYPING_RUN_MS;
    lastEdit = { kind, at: now, boundary };
    if (coalesce) return;
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function edit(kind: EditKind, mutate: () => void) {
    checkpoint(kind);
    mutate();
    notify();
  }

  function command(mutate: () => boolean): boolean {
    if (!active) return false;
    const depth = undoStack.length;
    checkpoint("command");
    if (!mutate()) {
      if (undoStack.length > depth) undoStack.pop();
      return false;
    }
    notify();
    return true;
  }

  function undo() {
    const state = active ? undoStack.pop() : undefined;
    if (!state) return false;
    redoStack.push(snapshot());
    restore(state);
    lastEdit = null;
    notify();
    return true;
  }

  function redo() {
    const state = active ? redoStack.pop() : undefined;
    if (!state) return false;
    undoStack.push(snapshot());
    restore(state);
    lastEdit = null;
    notify();
    return true;
  }

  function listItemAt(node: Node): HTMLElement | null {
    for (
      let current = node instanceof HTMLElement ? node : node.parentElement;
      current && current !== el && el.contains(current);
      current = current.parentElement
    ) {
      const parentTag = current.parentElement?.tagName;
      if (
        current.tagName === "LI" &&
        (parentTag === "UL" || parentTag === "OL")
      )
        return current;
    }
    return null;
  }

  /** A styled bullet row (marker span + text) whose list lies inside `el`. */
  function legacyRowAt(node: Node): HTMLElement | null {
    const start = node instanceof HTMLElement ? node : node.parentElement;
    if (!start) return null;
    const list = findEnclosingList(start, el);
    if (
      !list ||
      !el.contains(list) ||
      list.tagName === "UL" ||
      list.tagName === "OL"
    ) {
      return null;
    }
    let row: Node | null = node;
    while (row && row.parentNode !== list) row = row.parentNode;
    return row instanceof HTMLElement && isBulletRow(row) ? row : null;
  }

  /** Any bullet row around `node`, including the edited element itself. */
  function bulletRowAt(node: Node): HTMLElement | null {
    for (
      let current = node instanceof HTMLElement ? node : node.parentElement;
      current && el.contains(current);
      current = current.parentElement
    ) {
      if (isBulletRow(current)) return current;
    }
    return null;
  }

  /** Keeps the caret in a text node, so typing inherits the styles around it. */
  function settleCaret(node: Node, offset: number) {
    if (node instanceof Text && node.length === 0) {
      node.data = ZERO_WIDTH_SPACE;
      placeCaret(node, 1);
      return;
    }
    const block = nearestLineBox(node, el);
    if (
      !hasRenderedContent(block) &&
      !block.textContent?.includes(ZERO_WIDTH_SPACE)
    ) {
      const placeholder = document.createTextNode(ZERO_WIDTH_SPACE);
      const at = document.createRange();
      at.setStart(node, offset);
      at.insertNode(placeholder);
      placeCaret(placeholder, 1);
      return;
    }
    placeCaret(node, offset);
  }

  /**
   * Moves an edge that sits on an element (Mod-A, a triple click) onto the
   * text it bounds, when only empty markup lies between. Deleting then keeps
   * the first run, item, or row instead of emptying the element around it.
   */
  function snapToText(range: Range) {
    const snap = (node: Node, offset: number, before: boolean) => {
      if (node instanceof Text) return null;
      const point = textPoint(el, textOffset(el, node, offset), before);
      if (range.comparePoint(...point) !== 0) return null;
      const skipped = document.createRange();
      if (before) {
        skipped.setStart(...point);
        skipped.setEnd(node, offset);
      } else {
        skipped.setStart(node, offset);
        skipped.setEnd(...point);
      }
      return hasRenderedContent(skipped.cloneContents()) ? null : point;
    };
    const start = snap(range.startContainer, range.startOffset, false);
    const end = snap(range.endContainer, range.endOffset, true);
    if (start) range.setStart(...start);
    if (end) range.setEnd(...end);
  }

  /** Deletes a range and joins the blocks it crossed, without new styling. */
  function deleteRange(range: Range) {
    snapToText(range);
    const markerRow = bulletRowAt(range.startContainer);
    const startMarker = markerRow ? rowMarker(markerRow) : null;
    if (startMarker && range.intersectsNode(startMarker)) {
      range.setStartAfter(startMarker);
    }
    const startRow = legacyRowAt(range.startContainer);
    const endRow = legacyRowAt(range.endContainer);
    const startBlock = nearestBlock(range.startContainer, el);
    const endBlock = nearestBlock(range.endContainer, el);
    // A range across blocks collapses *between* them after deleteContents;
    // its original start point is still inside the first block.
    const caretNode = range.startContainer;
    const caretOffset = range.startOffset;
    range.deleteContents();
    if (
      startBlock !== endBlock &&
      endBlock !== el &&
      endBlock.isConnected &&
      !endBlock.contains(startBlock) &&
      !STRUCTURAL_BLOCK_TAGS.has(startBlock.tagName) &&
      !STRUCTURAL_BLOCK_TAGS.has(endBlock.tagName)
    ) {
      const rows = startRow && endRow && startRow !== endRow;
      const into = rows
        ? rowTextContainer(startRow, rowMarker(startRow))
        : startBlock;
      const from = rows
        ? rowTextContainer(endRow, rowMarker(endRow))
        : endBlock;
      const removed = rows ? endRow : endBlock;
      let anchor: Node | null = null;
      if (into.contains(from)) {
        anchor = from;
        while (anchor.parentNode !== into) anchor = anchor.parentNode!;
      }
      const moved = Array.from(from.childNodes).filter(
        (child) => !(child instanceof HTMLElement && isBulletMarker(child)),
      );
      for (const child of moved) into.insertBefore(child, anchor);
      let parent = removed.parentElement;
      removed.remove();
      while (
        parent &&
        parent !== el &&
        (parent.tagName === "UL" || parent.tagName === "OL") &&
        parent.children.length === 0
      ) {
        const next: HTMLElement | null = parent.parentElement;
        parent.remove();
        parent = next;
      }
    }
    settleCaret(caretNode, caretOffset);
  }

  function mergeRows(into: HTMLElement, from: HTMLElement) {
    const target = rowTextContainer(into, rowMarker(into));
    const source = rowTextContainer(from, rowMarker(from));
    const [node, offset] = textPoint(target, Infinity);
    const marker = rowMarker(from);
    target.append(
      ...Array.from(source.childNodes).filter((child) => child !== marker),
    );
    from.remove();
    placeCaret(node, offset);
  }

  /**
   * Backspace at the start of a styled bullet row joins it to the previous
   * row, and Delete at its end pulls the next one in. Neither ever deletes a
   * marker span, which would turn a bullet into a plain line.
   */
  function deleteAtRowEdge(caret: Range, direction: DeleteDirection) {
    const row = legacyRowAt(caret.startContainer);
    if (!row) return false;
    const list = row.parentElement!;
    const rows = legacyRows(list);
    if (
      direction === "backward" &&
      rows.length >= 2 &&
      removeEmptyBulletAtCaret(list)
    ) {
      return true;
    }
    const marker = rowMarker(row);
    const text = rowTextContainer(row, marker);
    const edge = document.createRange();
    if (direction === "backward") {
      if (text === row && marker) edge.setStartAfter(marker);
      else edge.setStart(text, 0);
      edge.setEnd(caret.startContainer, caret.startOffset);
    } else {
      edge.setStart(caret.startContainer, caret.startOffset);
      edge.setEnd(text, text.childNodes.length);
    }
    if (hasRenderedContent(edge.cloneContents())) return false;
    const index = rows.indexOf(row);
    const [into, from] =
      direction === "backward"
        ? [rows[index - 1], row]
        : [row, rows[index + 1]];
    if (into && from) mergeRows(into, from);
    return true;
  }

  function deleteByInput(type: string, range: Range) {
    if (!range.collapsed) {
      deleteRange(range);
      return;
    }
    const step = DELETE_STEPS[type];
    if (!step) return;
    const [direction, granularity] = step;
    if (deleteAtRowEdge(range, direction)) return;
    const selection = window.getSelection()!;
    if (typeof selection.modify !== "function") {
      throw new Error("in-place text session: Selection.modify is missing");
    }
    selection.modify("extend", direction, granularity);
    // A placeholder is invisible, so deleting only it would look like a no-op.
    if (
      granularity === "character" &&
      PLACEHOLDER_ONLY.test(selection.toString())
    ) {
      selection.modify("extend", direction, granularity);
    }
    const extended = selectionRange();
    if (extended && !extended.collapsed) deleteRange(extended);
  }

  function isNativeInsert(range: Range) {
    return (
      range.collapsed &&
      range.startContainer instanceof Text &&
      range.startContainer.length > 0
    );
  }

  /** Only a delete that stays inside one text node and leaves it non-empty. */
  function isNativeDelete(type: string, range: Range) {
    const text = range.startContainer;
    if (
      !(text instanceof Text) ||
      range.endContainer !== text ||
      text.data.includes(ZERO_WIDTH_SPACE)
    ) {
      return false;
    }
    if (!range.collapsed) {
      return range.endOffset - range.startOffset < text.length;
    }
    if (type !== "deleteContentBackward" && type !== "deleteContentForward") {
      return false;
    }
    const cluster = graphemeAt(
      text.data,
      range.startOffset,
      type === "deleteContentBackward",
    );
    return cluster !== null && cluster.length < text.length;
  }

  function insertText(data: string, range: Range) {
    if (!range.collapsed) deleteRange(range);
    else placeCaret(range.startContainer, range.startOffset);
    const caret = selectionRange();
    if (!caret || !data) return;
    const node = caret.startContainer;
    if (node instanceof Text) {
      node.insertData(caret.startOffset, data);
      placeCaret(node, caret.startOffset + data.length);
      return;
    }
    const text = document.createTextNode(data);
    caret.insertNode(text);
    placeCaret(text, data.length);
  }

  /** `<br>` plus, when nothing follows it, a placeholder that keeps the new line open. */
  function insertLineBreak(range: Range) {
    if (!range.collapsed) deleteRange(range);
    const caret = selectionRange();
    if (!caret) return;
    const br = document.createElement("br");
    caret.insertNode(br);
    if (renderedAfter(br, nearestLineBox(br, el))) {
      const next = br.nextSibling;
      if (next instanceof Text) placeCaret(next, 0);
      else
        placeCaret(
          br.parentNode!,
          Array.from(br.parentNode!.childNodes).indexOf(br) + 1,
        );
      return;
    }
    const placeholder = document.createTextNode(ZERO_WIDTH_SPACE);
    br.after(placeholder);
    placeCaret(placeholder, 1);
  }

  /** Splits `block` at the caret into itself and a same-attribute sibling. */
  function splitBlock(block: HTMLElement, caret: Range) {
    const { startContainer, startOffset } = caret;
    const tail = document.createRange();
    tail.setStart(startContainer, startOffset);
    tail.setEnd(block, block.childNodes.length);
    const moved = extractWithoutCopiedIdentity(tail);
    const clone = block.cloneNode(false) as HTMLElement;
    stripCopiedIdentity(clone);
    clone.append(moved);
    block.after(clone);
    if (!block.textContent?.replaceAll(/\s/g, "")) {
      // At the caret, not where extractContents collapsed the range (after
      // the inline element), so a return to this line keeps its style.
      const head = document.createRange();
      head.setStart(startContainer, startOffset);
      head.insertNode(document.createTextNode(ZERO_WIDTH_SPACE));
    }
    const [first, offset] = textPoint(clone, 0);
    // Text that only starts inside a nested list is not this line's text.
    if (hasRenderedContent(clone) && nearestBlock(first, el) === clone) {
      placeCaret(first, offset);
      return;
    }
    // Typing on the new line continues the inline style the caret was in.
    let target: Element = clone;
    for (
      let child = target.firstElementChild;
      child && !child.matches(RENDERED_ELEMENTS) && !isBlock(child);
      child = target.firstElementChild
    ) {
      target = child;
    }
    const placeholder = document.createTextNode(ZERO_WIDTH_SPACE);
    target.prepend(placeholder);
    placeCaret(placeholder, 1);
  }

  function indent(item: HTMLElement) {
    const previous = item.previousElementSibling;
    if (!(previous instanceof HTMLElement) || previous.tagName !== "LI") {
      return false;
    }
    const list = item.parentElement!;
    let nested = previous.lastElementChild;
    if (!nested || nested.tagName !== list.tagName) {
      const computed = window.getComputedStyle(list);
      nested = document.createElement(list.tagName);
      nested.setAttribute(
        "style",
        `margin:0;padding-left:1.25em;list-style-position:${computed.listStylePosition || "outside"};list-style-type:${computed.listStyleType || (list.tagName === "OL" ? "decimal" : "disc")};`,
      );
      previous.append(nested);
    }
    nested.append(item);
    return true;
  }

  /** Legacy rows nest by padding, not structure: only a declaration changes. */
  function indentRow(row: HTMLElement, direction: 1 | -1) {
    // An unset padding reads as "" outside a layout engine; it is zero.
    const padding = window.getComputedStyle(row).paddingLeft || "0px";
    const current = Number.parseFloat(padding);
    const next = Math.max(0, current + direction * LEGACY_ROW_INDENT_PX);
    if (!Number.isFinite(next) || next === current) return false;
    row.style.setProperty("padding-left", `${next}px`);
    return true;
  }

  function outdent(item: HTMLElement) {
    const list = item.parentElement;
    const parentItem = list?.parentElement;
    if (!list || !parentItem || listItemAt(parentItem) !== parentItem) {
      return false;
    }
    const following: Element[] = [];
    for (
      let next = item.nextElementSibling;
      next;
      next = next.nextElementSibling
    ) {
      following.push(next);
    }
    if (following.length > 0) {
      const nested = list.cloneNode(false) as HTMLElement;
      stripCopiedIdentity(nested);
      nested.append(...following);
      item.append(nested);
    }
    parentItem.after(item);
    if (list.children.length === 0) list.remove();
    return true;
  }

  function splitListItem(item: HTMLElement, caret: Range) {
    if (!hasRenderedContent(item) && !item.nextElementSibling) {
      // An empty last item ends the list: a nested one steps out a level, a
      // top-level one is dropped because the list itself is the edited root.
      if (keepingSelection(() => outdent(item))) return;
      const previous = item.previousElementSibling;
      if (previous) {
        item.remove();
        placeCaret(...textPoint(previous, Infinity));
        return;
      }
    }
    splitBlock(item, caret);
  }

  /** Enter never changes the edited element's own tag, class, or style. */
  function insertParagraph(range: Range) {
    if (!range.collapsed) deleteRange(range);
    const caret = selectionRange();
    if (!caret) return;
    const item = listItemAt(caret.startContainer);
    if (item) {
      splitListItem(item, caret);
      return;
    }
    const row = legacyRowAt(caret.startContainer);
    if (row) {
      const list = row.parentElement!;
      const rows = legacyRows(list);
      if (
        row === rows[rows.length - 1] &&
        rows.length >= 2 &&
        isEmptyRow(row) &&
        removeEmptyBulletAtCaret(list)
      ) {
        return;
      }
      if (insertBulletAfterCaret(list)) return;
    }
    const block = nearestBlock(caret.startContainer, el);
    if (block === el || STRUCTURAL_BLOCK_TAGS.has(block.tagName)) {
      insertLineBreak(caret);
    } else {
      splitBlock(block, caret);
    }
  }

  function insertFragment(fragment: DocumentFragment) {
    const caret = selectionRange();
    const last = fragment.lastChild;
    if (!caret || !last) return;
    if (fragment.childNodes.length === 1 && last instanceof Text) {
      insertText(last.data, caret);
      return;
    }
    caret.insertNode(fragment);
    if (last instanceof Text) {
      placeCaret(last, last.length);
      return;
    }
    const after = document.createRange();
    after.setStartAfter(last);
    placeCaret(after.startContainer, after.startOffset);
  }

  /**
   * Pasted list items stay list items where the caret can hold them: in a
   * list item they become items at their own depth, and in a container that
   * may hold a list they arrive as one. A paragraph or heading cannot hold a
   * list, so there they are lines like any other paste.
   */
  function insertClipboard(data: DataTransfer, at: Range) {
    const html = data.getData("text/html");
    const normalized = html ? normalizeSlideClipboardHtml(html) : null;
    const lines =
      normalized !== null
        ? pastedHtmlLines(normalized)
        : plainTextLines(data.getData("text/plain"));
    const start = at.startContainer;
    const link = (
      start instanceof Element ? start : start.parentElement
    )?.closest("a");
    if (link && el.contains(link)) {
      // A link inside a link is split in two when the slide is parsed again.
      for (const { fragment } of lines) {
        for (const anchor of Array.from(fragment.querySelectorAll("a"))) {
          anchor.replaceWith(...Array.from(anchor.childNodes));
        }
      }
    }
    if (!at.collapsed) deleteRange(at);
    else placeCaret(at.startContainer, at.startOffset);
    const caret = selectionRange();
    if (
      caret &&
      lines.length > 0 &&
      lines.every(({ lists }) => lists.length > 0) &&
      !listItemAt(caret.startContainer) &&
      !legacyRowAt(caret.startContainer) &&
      LIST_HOLDER_TAGS.has(nearestBlock(caret.startContainer, el).tagName)
    ) {
      const list = pastedList(lines);
      caret.insertNode(list);
      placeCaret(...textPoint(list, Infinity));
      return;
    }
    let depth = lines[0]?.lists.length ?? 0;
    lines.forEach((line, index) => {
      const caret = selectionRange();
      if (!caret) return;
      if (index > 0) {
        insertParagraph(caret);
        const item = selectionRange()?.startContainer;
        const target = line.lists.length;
        const current = item ? listItemAt(item) : null;
        if (current && target > 0) {
          while (depth < target && keepingSelection(() => indent(current))) {
            depth += 1;
          }
          while (depth > target && keepingSelection(() => outdent(current))) {
            depth -= 1;
          }
        }
      }
      insertFragment(line.fragment);
    });
  }

  function applyMarkdownShortcut() {
    const caret = selectionRange();
    if (!caret?.collapsed) return;
    const block = nearestBlock(caret.startContainer, el);
    const prefix = document.createRange();
    prefix.setStart(block, 0);
    prefix.setEnd(caret.startContainer, caret.startOffset);
    const typed = prefix.toString().replaceAll(ZERO_WIDTH_SPACE, "");
    if (block === el && /^[-*] $/.test(typed)) {
      command(() => {
        const tag = el.tagName;
        if (tag === "P") retagRoot("DIV");
        if (convertMarkdownPrefixToBullet(el)) return true;
        if (el.tagName !== tag) retagRoot(tag);
        return false;
      });
      return;
    }
    if (block === el && typed === "1. ") {
      command(() => {
        prefix.deleteContents();
        if (!hasRenderedContent(el)) el.prepend(ZERO_WIDTH_SPACE);
        const next = toggleSlideList(el, "ordered");
        if (!next) return false;
        if (next !== el) rebind(next);
        const [node, offset] = textPoint(el, 0);
        placeCaret(
          node,
          node instanceof Text && PLACEHOLDER_ONLY.test(node.data)
            ? node.length
            : offset,
        );
        return true;
      });
      return;
    }
    const heading = /^(#{1,3}) $/.exec(typed);
    if (
      heading &&
      block !== el &&
      block.tagName !== "LI" &&
      !STRUCTURAL_BLOCK_TAGS.has(block.tagName)
    ) {
      command(() => {
        prefix.deleteContents();
        const next = retag(block, `H${heading[1].length}`);
        if (hasRenderedContent(next)) placeCaret(...textPoint(next, 0));
        else settleCaret(next, 0);
        return true;
      });
    }
  }

  /** Retags the edited element, keeping the caret: a <p> cannot hold a list row. */
  function retagRoot(tagName: string) {
    const range = selectionRange();
    const caret = range
      ? ([range.startContainer, range.startOffset] as const)
      : null;
    rebind(retag(el, tagName));
    if (caret) placeCaret(...caret);
  }

  function styleCommand(apply: () => InlineTextStyleApplication) {
    return command(() => {
      const range = selectionRange();
      if (!range) return false;
      if (!range.collapsed) return apply().scope === "selection";
      // A caret gets a pending run: typing lands inside its style span, and
      // an unused one is dropped by end().
      let pending = range.startContainer;
      const parent = pending.parentElement;
      if (
        !(pending instanceof Text) ||
        !PLACEHOLDER_ONLY.test(pending.data) ||
        !parent?.matches("span[data-slide-inline-style]") ||
        parent.childNodes.length !== 1
      ) {
        const span = document.createElement("span");
        span.dataset.slideInlineStyle = "true";
        pending = document.createTextNode(ZERO_WIDTH_SPACE);
        span.append(pending);
        range.insertNode(span);
      }
      const selection = window.getSelection()!;
      const select = document.createRange();
      select.selectNodeContents(pending);
      selection.removeAllRanges();
      selection.addRange(select);
      apply();
      placeCaret(pending, (pending as Text).length);
      return true;
    });
  }

  const commands: InPlaceTextSessionCommands = {
    bold: () => styleCommand(() => toggleInlineTextFormat(el, "bold")),
    italic: () => styleCommand(() => toggleInlineTextFormat(el, "italic")),
    underline: () =>
      styleCommand(() => toggleInlineTextFormat(el, "underline")),
    strike: () => styleCommand(() => toggleInlineTextFormat(el, "strike")),
    color: (value) =>
      styleCommand(() => applyInlineTextStyle(el, { color: value })),
    fontSize: (value) =>
      styleCommand(() => applyInlineTextStyle(el, { fontSize: value })),
    fontFamily: (value) =>
      styleCommand(() => applyInlineTextStyle(el, { fontFamily: value })),
    textStyle: (patch) => styleCommand(() => applyInlineTextStyle(el, patch)),
    link: (href) =>
      command(() => {
        const range = selectionRange();
        return (
          !!range &&
          !range.collapsed &&
          setInlineTextLink(el, href).scope === "selection"
        );
      }),
    align: (value) =>
      command(() => {
        el.style.setProperty("text-align", value);
        return true;
      }),
    toggleList: (kind) =>
      command(() =>
        keepingSelection(() => {
          const next = toggleSlideList(el, kind);
          if (!next) return false;
          if (next !== el) rebind(next);
          return true;
        }),
      ),
  };

  function targetRange(event: InputEvent): Range | null {
    const [target] = event.getTargetRanges?.() ?? [];
    if (
      !target ||
      !el.contains(target.startContainer) ||
      !el.contains(target.endContainer)
    ) {
      return null;
    }
    const range = document.createRange();
    range.setStart(target.startContainer, target.startOffset);
    range.setEnd(target.endContainer, target.endOffset);
    return range;
  }

  function onBeforeInput(event: InputEvent) {
    const type = event.inputType;
    if (COMPOSITION_INPUTS.has(type)) return;
    if (event.isComposing) {
      // Enter that confirms an IME composition must not also split a line.
      if (type === "insertParagraph" || type === "insertLineBreak") {
        event.preventDefault();
      }
      return;
    }
    if (!event.cancelable) {
      checkpoint(type.startsWith("delete") ? "delete" : "typing");
      return;
    }
    if (type === "historyUndo" || type === "historyRedo") {
      event.preventDefault();
      if (type === "historyUndo") undo();
      else redo();
      return;
    }
    const range = selectionRange();
    const dropJoins = dragDeleted && type === "insertFromDrop";
    dragDeleted = false;
    if (type === "deleteByDrag") {
      // Chrome deletes a moved selection first and then drops it: both
      // halves are one step. Inside one text node Chrome's delete also
      // drops the doubled space; anywhere else it would add its markup.
      const dragged = targetRange(event) ?? range;
      if (dragged && isNativeDelete(type, dragged)) {
        checkpoint("command");
        dragDeleted = true;
        return;
      }
      event.preventDefault();
      if (!dragged) return;
      edit("command", () => deleteRange(dragged));
      dragDeleted = true;
      return;
    }
    if (type === "insertText" || type === "insertReplacementText") {
      const data =
        event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
      if (type === "insertText" && range && isNativeInsert(range)) {
        checkpoint("typing", /\s/.test(data));
        return;
      }
      event.preventDefault();
      const target =
        (type === "insertReplacementText" ? targetRange(event) : null) ?? range;
      if (!target) return;
      edit("typing", () => insertText(data, target));
      if (data === " ") applyMarkdownShortcut();
      return;
    }
    if (type.startsWith("delete")) {
      if (range && isNativeDelete(type, range)) {
        checkpoint("delete");
        return;
      }
      event.preventDefault();
      if (range) edit("delete", () => deleteByInput(type, range));
      return;
    }
    // Every input type not handled below would inject browser markup.
    event.preventDefault();
    if (!range) return;
    if (type === "insertParagraph") {
      edit("command", () => insertParagraph(range));
    } else if (type === "insertLineBreak") {
      edit("command", () => insertLineBreak(range));
    } else if (PASTE_INPUTS.has(type)) {
      const data = event.dataTransfer;
      if (!data) {
        throw new Error(`in-place text session: ${type} has no dataTransfer`);
      }
      const at =
        (type === "insertFromDrop" ? targetRange(event) : null) ?? range;
      if (dropJoins) {
        insertClipboard(data, at);
        notify();
      } else {
        edit("command", () => insertClipboard(data, at));
      }
    } else if (FORMAT_INPUTS[type]) {
      commands[FORMAT_INPUTS[type]]();
    } else if (ALIGN_INPUTS[type]) {
      commands.align(ALIGN_INPUTS[type]);
    } else if (type === "formatIndent" || type === "formatOutdent") {
      const item = listItemAt(range.startContainer);
      if (item) {
        command(() =>
          keepingSelection(() =>
            type === "formatIndent" ? indent(item) : outdent(item),
          ),
        );
      }
    }
  }

  function onInput(event: Event) {
    const input = event as InputEvent;
    if (input.inputType === "insertText" && input.data === " ") {
      applyMarkdownShortcut();
    }
    notify();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const mod = (event.metaKey || event.ctrlKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      // historyUndo is only proven cancelable in Chromium; own the shortcut.
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === "y" && !event.shiftKey) {
      event.preventDefault();
      redo();
    } else if (mod && key === "a" && !event.shiftKey) {
      event.preventDefault();
      selectAllEditableText(el);
    } else if (mod && event.shiftKey && key === "s") {
      event.preventDefault();
      commands.strike();
    } else if (
      mod &&
      event.shiftKey &&
      (event.code === "Digit7" || event.code === "Digit8")
    ) {
      event.preventDefault();
      commands.toggleList(event.code === "Digit7" ? "ordered" : "bullet");
    } else if (event.key === "Tab" && !mod) {
      // Tab never moves focus out of the text being edited; Escape ends it.
      event.preventDefault();
      const range = selectionRange();
      if (!range) return;
      const item = listItemAt(range.startContainer);
      if (item) {
        command(() =>
          keepingSelection(() =>
            event.shiftKey ? outdent(item) : indent(item),
          ),
        );
        return;
      }
      const row = legacyRowAt(range.startContainer);
      if (row) command(() => indentRow(row, event.shiftKey ? -1 : 1));
    }
  }

  function onPaste(event: ClipboardEvent) {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data) throw new Error("in-place text session: paste has no data");
    const range = selectionRange();
    if (range) edit("command", () => insertClipboard(data, range));
  }

  /**
   * The selection as the slide's own markup. Chrome's default serializer
   * writes every computed style (a white background, `display`, custom
   * properties) onto each run, and a paste or drop would keep it.
   */
  function writeSelection(data: DataTransfer, range: Range) {
    const holder = document.createElement("div");
    holder.append(range.cloneContents());
    for (const text of textNodesIn(holder)) {
      text.data = text.data.replaceAll(ZERO_WIDTH_SPACE, "");
    }
    const html = normalizeSlideClipboardHtml(holder.innerHTML);
    if (html !== null) data.setData("text/html", html);
    data.setData(
      "text/plain",
      (window.getSelection()?.toString() ?? "").replaceAll(
        ZERO_WIDTH_SPACE,
        "",
      ),
    );
  }

  function onCopy(event: ClipboardEvent) {
    const range = selectionRange();
    if (!range || range.collapsed || !event.clipboardData) return;
    event.preventDefault();
    writeSelection(event.clipboardData, range);
    if (event.type === "cut") edit("command", () => deleteRange(range));
  }

  function onDragStart(event: DragEvent) {
    const range = selectionRange();
    if (range && !range.collapsed && event.dataTransfer) {
      writeSelection(event.dataTransfer, range);
    }
  }

  /**
   * Chrome deletes a selection that spans blocks natively when a composition
   * starts over it, splitting an item's text from its nested list; the
   * session deletes it first, the way it does for typing.
   */
  function onCompositionStart() {
    const range = selectionRange();
    const acrossNodes =
      range &&
      !range.collapsed &&
      !(
        range.startContainer instanceof Text &&
        range.startContainer === range.endContainer
      );
    if (acrossNodes) edit("typing", () => deleteRange(range));
    else checkpoint("typing");
  }

  const listeners: [string, (event: never) => void][] = [
    ["beforeinput", onBeforeInput],
    ["input", onInput],
    ["keydown", onKeyDown],
    ["paste", onPaste],
    ["copy", onCopy],
    ["cut", onCopy],
    ["dragstart", onDragStart],
    ["compositionstart", onCompositionStart],
  ];

  function listen(target: HTMLElement) {
    for (const [type, listener] of listeners) {
      target.addEventListener(type, listener as EventListener);
    }
  }

  function unlisten(target: HTMLElement) {
    for (const [type, listener] of listeners) {
      target.removeEventListener(type, listener as EventListener);
    }
  }

  function rebind(next: HTMLElement) {
    unlisten(el);
    el = next;
    listen(el);
    el.focus({ preventScroll: true });
  }

  /**
   * The last placeholder of a line that is otherwise empty becomes the `<br>`
   * that keeps the line open (a trailing `<br>` alone renders nothing); every
   * other placeholder character is removed.
   */
  function settlePlaceholders() {
    for (const text of textNodesIn(el)) {
      if (authorZwsp.has(text) || !text.data.includes(ZERO_WIDTH_SPACE)) {
        continue;
      }
      const block = nearestLineBox(text, el);
      const rest = lineRest(text, block);
      if (
        PLACEHOLDER_ONLY.test(text.data) &&
        !hasRenderedContent(rest) &&
        !rest.textContent?.includes(ZERO_WIDTH_SPACE) &&
        renderedBefore(text, block) !== "content"
      ) {
        text.replaceWith(document.createElement("br"));
      } else {
        text.data = text.data.replaceAll(ZERO_WIDTH_SPACE, "");
      }
    }
  }

  /**
   * Chrome's native typing deletes collapsed whitespace (source indentation)
   * next to the caret and can replace a text node, so typing and deleting back
   * is not byte-identical on its own. An edit whose net effect is invisible is
   * no edit: `end()` restores the exact start bytes, so nothing is written.
   */
  function hasVisibleChange() {
    if (el.innerHTML === startHtml) return false;
    // A pending style run nothing was typed into is dropped by end().
    const live = el.cloneNode(true) as HTMLElement;
    for (const span of Array.from(
      live.querySelectorAll("span[data-slide-inline-style]"),
    )) {
      if (!span.textContent?.replaceAll(ZERO_WIDTH_SPACE, "")) {
        span.replaceWith(...Array.from(span.childNodes));
      }
    }
    const squash = (value: string) =>
      value.replace(/\s+/g, "").replaceAll(ZERO_WIDTH_SPACE, "");
    return (
      el !== element ||
      squash(live.innerHTML) !== squash(startHtml) ||
      el.innerText.replaceAll(ZERO_WIDTH_SPACE, "") !==
        startText.replaceAll(ZERO_WIDTH_SPACE, "")
    );
  }

  function cloneWithoutPlaceholders(root: HTMLElement): HTMLElement {
    const copy = root.cloneNode(true) as HTMLElement;
    const copies = textNodesIn(copy);
    textNodesIn(root).forEach((text, index) => {
      const placeholder = copies[index];
      if (
        !el.contains(text) ||
        authorZwsp.has(text) ||
        !text.data.includes(ZERO_WIDTH_SPACE)
      ) {
        return;
      }
      const rest = text.data.replaceAll(ZERO_WIDTH_SPACE, "");
      // A lone placeholder keeps an empty run from collapsing, so the run
      // keeps its font; anywhere else it is dropped.
      if (rest) placeholder.data = rest;
      else if (placeholder.parentNode?.childNodes.length !== 1) {
        placeholder.remove();
      }
    });
    return copy;
  }

  function end() {
    if (!active) return;
    active = false;
    unlisten(el);
    unscroll();
    for (const [ancestor] of pinnedScroll) {
      ancestor.removeEventListener("scroll", unscroll);
    }
    if (el.innerHTML !== startHtml) {
      if (!hasVisibleChange()) {
        el.innerHTML = startHtml;
      } else {
        settlePlaceholders();
        // Only an unused pending-style run; adjacent style spans the slide
        // already had are not this session's to merge.
        for (const span of Array.from(
          el.querySelectorAll("span[data-slide-inline-style]"),
        )) {
          if (!span.textContent && span.children.length === 0) span.remove();
        }
      }
    }
    if (edited) {
      // Chrome reshapes only the edited span of a text node, so typing and
      // deleting next to a joined Arabic letter leaves it drawn unjoined
      // until the node is recreated. The markup stays identical.
      el.normalize();
      for (const text of textNodesIn(el)) text.replaceWith(text.cloneNode());
    }
    if (initialContentEditable === null) el.removeAttribute("contenteditable");
    else el.setAttribute("contenteditable", initialContentEditable);
    if (initialEditingBlock === null) el.removeAttribute("data-editing-block");
    else el.setAttribute("data-editing-block", initialEditingBlock);
  }

  const selection = window.getSelection();
  const initialRange =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null;
  el.setAttribute("contenteditable", "true");
  el.setAttribute("data-editing-block", "true");
  listen(el);
  for (const [ancestor] of pinnedScroll) {
    ancestor.addEventListener("scroll", unscroll);
  }
  // Firefox draws resize handles on images and tables inside an editable.
  document.execCommand?.("enableObjectResizing", false, "false");
  el.focus({ preventScroll: true });
  const point = options.caretPoint ? caretFromPoint(options.caretPoint) : null;
  if (point && el.contains(point[0])) {
    placeCaret(...point);
  } else if (
    selection &&
    initialRange &&
    el.contains(initialRange.startContainer) &&
    el.contains(initialRange.endContainer)
  ) {
    selection.removeAllRanges();
    selection.addRange(initialRange);
  } else {
    placeCaret(...textPoint(el, Infinity));
  }
  // An element with nothing to lay out has no line box to hold a caret (a
  // text box placed with a click is 0px tall), and Chrome drops typing into
  // it. end() removes the placeholder again when nothing was typed.
  if (!hasRenderedContent(el) && !el.textContent?.includes(ZERO_WIDTH_SPACE)) {
    settleCaret(el, el.childNodes.length);
  }

  return {
    get element() {
      return el;
    },
    get isActive() {
      return active;
    },
    get changed() {
      return active ? hasVisibleChange() : el.innerHTML !== startHtml;
    },
    commands,
    apply: (mutate) =>
      command(() => {
        mutate();
        return true;
      }),
    undo,
    redo,
    cloneWithoutPlaceholders,
    end,
  };
}
