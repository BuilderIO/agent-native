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
  rowTextRange,
  stripCopiedIdentity,
  ZERO_WIDTH_SPACE,
} from "./bullet-editing";
import {
  createSlideList,
  headingTextLook,
  keepTextLook,
  type TextLook,
  slideListRows,
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
  /**
   * Viewport point of the click that started editing. The caret lands there
   * unless the native selection (a double-clicked word) already covers it.
   */
  caretPoint?: { x: number; y: number } | null;
  /** Select the word at `caretPoint`, as a native double-click would. */
  selectWord?: boolean;
  /** Called after every change to the edited content. */
  onInput?: () => void;
  /** Opens the existing link control for a selected range. */
  onRequestLink?: (range: Range) => void;
}

export type SlideTextAlign = "left" | "center" | "right" | "justify";

export type InPlaceTextAuthoringCommand =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "bulletList"
  | "orderedList"
  | "quote"
  | "divider";

export interface InPlaceTextSessionCommands {
  bold: () => boolean;
  italic: () => boolean;
  underline: () => boolean;
  strike: () => boolean;
  code: () => boolean;
  color: (value: string) => boolean;
  fontSize: (value: string) => boolean;
  fontFamily: (value: string) => boolean;
  textStyle: (patch: InlineTextStylePatch) => boolean;
  /** Links the selected text; `null` unlinks it. */
  link: (href: string | null) => boolean;
  align: (value: SlideTextAlign) => boolean;
  toggleList: (kind: SlideListKind) => boolean;
  applyAuthoringCommand: (
    command: InPlaceTextAuthoringCommand,
    slashRange?: Range,
  ) => boolean;
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
  "CODE",
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
const FOREIGN_PASTE_STYLE_PROPERTY =
  /^(color|font(?:-.+)?|letter-spacing|word-spacing|text-transform)$/;
const SLIDE_CLIPBOARD_TYPE = "application/x-agent-native-slide-text";
const TEXT_LOOK_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-transform",
] as const;
const SESSION_ROOT_ATTRIBUTES = new Set([
  "contenteditable",
  "data-editing-block",
  "aria-haspopup",
  "aria-autocomplete",
  "aria-expanded",
  "aria-controls",
  "aria-activedescendant",
]);
const SESSION_MENU_ARIA_ATTRIBUTES = new Set([
  "aria-haspopup",
  "aria-autocomplete",
  "aria-expanded",
  "aria-controls",
  "aria-activedescendant",
]);
/** An `<ol type>` restated as CSS, which preflight's `list-style: none` beats otherwise. */
const ORDERED_TYPE_MARKER: Record<string, string> = {
  "1": "decimal",
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};
const PLACEHOLDER_ONLY = new RegExp(`^${ZERO_WIDTH_SPACE}+$`);
const ALL_ZWSP = new RegExp(ZERO_WIDTH_SPACE, "g");
export const IN_PLACE_TEXT_UNDO_LIMIT = 512;
export const IN_PLACE_TEXT_UNDO_BYTE_LIMIT = 32 * 1024 * 1024;
/** How far Tab nests a legacy bullet row, the way generated decks draw sub-bullets. */
const LEGACY_ROW_INDENT_PX = 24;
const TYPING_RUN_MS = 1000;

function sourceTextLook(element: Element): TextLook {
  const computed = element.ownerDocument.defaultView!.getComputedStyle(element);
  return TEXT_LOOK_PROPERTIES.map((property) => [
    property,
    computed.getPropertyValue(property),
  ]);
}

function authoredTextLook(element: Element): TextLook {
  const style = (element as HTMLElement).style;
  return TEXT_LOOK_PROPERTIES.map((property) => [
    property,
    style.getPropertyValue(property),
  ]);
}

function applyTextLook(target: HTMLElement, look: TextLook) {
  for (const [property, value] of look) {
    if (value) target.style.setProperty(property, value);
  }
}

function blockTextLook(element: Element): TextLook | null {
  return ["P", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
    element.tagName,
  )
    ? sourceTextLook(element)
    : null;
}

function preserveBlockMargins(source: Element, target: HTMLElement) {
  applyBlockMargins(target, blockMargins(source));
}

function blockMargins(source: Element): TextLook {
  const computed = source.ownerDocument.defaultView!.getComputedStyle(source);
  return ["margin-top", "margin-right", "margin-bottom", "margin-left"].map(
    (property): [string, string] => [
      property,
      computed.getPropertyValue(property),
    ],
  );
}

function applyBlockMargins(target: HTMLElement, margins: TextLook) {
  for (const [property, value] of margins) {
    if (value) target.style.setProperty(property, value);
  }
}

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
  backward: boolean;
}

interface Snapshot extends TextOffsets {
  tag: string;
  attributes: [string, string][];
  html: string;
  byteSize: number;
  /** Which of the element's zero-width spaces, in text order, are the author's. */
  authorZwsp: number[];
}

/** One pasted line and the pasted UL/OL elements it was nested in, outermost first. */
interface PastedLine {
  fragment: DocumentFragment;
  lists: readonly HTMLElement[];
  sourceItem: HTMLElement | null;
  blockTag: "P" | "BLOCKQUOTE" | "H1" | "H2" | "H3" | "H4" | "HR" | null;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function countZwsp(text: string) {
  return text.split(ZERO_WIDTH_SPACE).length - 1;
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function textNodesIn(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node as Text);
  }
  return texts;
}

function laysOutOwnLines(element: Element) {
  // A flex or grid child's computed display is blockified, a <br>'s too, yet
  // Chrome lays a <br> out as a break in the anonymous item around the text.
  if (element.tagName === "BR") return false;
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
/** Select the word at a point in the editing root, even across styled runs. */
function selectWordAt(root: HTMLElement, node: Node, offset: number) {
  const segments = new Intl.Segmenter(undefined, { granularity: "word" });
  const lines: Text[][] = [];
  let line: Text[] = [];
  const finishLine = () => {
    if (line.length) lines.push(line);
    line = [];
  };
  const collectLines = (current: Node) => {
    if (current instanceof Text) {
      line.push(current);
      return;
    }
    if (!(current instanceof Element)) return;
    if (current !== root && current.tagName === "BR") {
      finishLine();
      return;
    }
    const block = current !== root && laysOutOwnLines(current);
    if (block) finishLine();
    for (const child of current.childNodes) collectLines(child);
    if (block) finishLine();
  };
  collectLines(root);
  finishLine();

  for (const texts of lines) {
    const first = texts[0]!;
    const last = texts.at(-1)!;
    const lineRange = document.createRange();
    lineRange.setStart(first, 0);
    lineRange.setEnd(last, last.length);
    if (lineRange.comparePoint(node, offset) !== 0) continue;

    const prefix = document.createRange();
    prefix.setStart(first, 0);
    prefix.setEnd(node, offset);
    const point = prefix.toString().length;
    const text = texts.map((textNode) => textNode.data).join("");
    const textPointInLine = (
      position: number,
      before = false,
    ): [Node, number] => {
      let remaining = position;
      for (const textNode of texts) {
        if (
          remaining < textNode.length ||
          (before && textNode.length > 0 && remaining === textNode.length)
        ) {
          return [textNode, remaining];
        }
        remaining -= textNode.length;
      }
      return [last, last.length];
    };

    for (const { index, segment, isWordLike } of segments.segment(text)) {
      if (!isWordLike || point < index || point > index + segment.length) {
        continue;
      }
      const range = document.createRange();
      range.setStart(...textPointInLine(index));
      range.setEnd(...textPointInLine(index + segment.length, true));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
  }
}

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
  if (next.tagName === "BLOCKQUOTE") {
    next.setAttribute("data-slide-authoring-format", "quote");
  } else {
    next.removeAttribute("data-slide-authoring-format");
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
      child instanceof HTMLElement &&
      (isBulletRow(child) || child.hasAttribute("data-slide-plain-row")),
  );
}

function appendPastedNode(
  node: Node,
  target: Node,
  preserveSlideStyles: boolean,
) {
  if (node instanceof Text) {
    target.appendChild(document.createTextNode(node.data));
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "IMG") {
    const alt = node.getAttribute("alt");
    if (alt) target.appendChild(document.createTextNode(alt));
    return;
  }
  let into = target;
  if (PASTE_INLINE_TAGS.has(node.tagName)) {
    const copy = document.createElement(node.tagName);
    if (node.tagName === "CODE") {
      copy.setAttribute("data-slide-authoring-format", "code");
    }
    for (let index = 0; index < node.style.length; index += 1) {
      const name = node.style.item(index);
      if (!PASTE_STYLE_PROPERTY.test(name)) continue;
      if (!preserveSlideStyles && FOREIGN_PASTE_STYLE_PROPERTY.test(name)) {
        continue;
      }
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
    appendPastedNode(child, into, preserveSlideStyles);
  }
}

/**
 * Pasted HTML as inline lines: each block becomes its own line, inline text
 * formatting keeps only its `style` (and a safe `href`), and every other
 * element is unwrapped, so pasting can never bring in layout or classes.
 */
function pastedHtmlLines(
  html: string,
  preserveSlideStyles: boolean,
): PastedLine[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const lines: PastedLine[] = [];
  const collect = (
    parent: Node,
    lists: readonly HTMLElement[],
    sourceItem: HTMLElement | null = null,
    blockTag: PastedLine["blockTag"] = null,
  ) => {
    let line: PastedLine | null = null;
    for (const child of Array.from(parent.childNodes)) {
      if (child instanceof HTMLElement && child.tagName === "HR") {
        line = null;
        lines.push({
          fragment: document.createDocumentFragment(),
          lists,
          sourceItem,
          blockTag: "HR",
        });
        continue;
      }
      if (child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName)) {
        line = null;
        const list = child.tagName === "UL" || child.tagName === "OL";
        const childTag =
          child.tagName === "BLOCKQUOTE" ||
          child.tagName === "H1" ||
          child.tagName === "H2" ||
          child.tagName === "H3" ||
          child.tagName === "H4"
            ? child.tagName
            : child.tagName === "P" && sourceItem && !blockTag
              ? "P"
              : blockTag;
        collect(
          child,
          list ? [...lists, child] : lists,
          child.tagName === "LI" ? child : sourceItem,
          childTag,
        );
        continue;
      }
      if (!line) {
        if (child instanceof Text && !child.data.trim()) continue;
        line = {
          fragment: document.createDocumentFragment(),
          lists,
          sourceItem,
          blockTag,
        };
        lines.push(line);
      }
      appendPastedNode(child, line.fragment, preserveSlideStyles);
    }
  };
  collect(template.content, [], null);
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
    return { fragment, lists: [], sourceItem: null, blockTag: null };
  });
}

function appendMarkdownInline(fragment: DocumentFragment, text: string) {
  const syntax =
    /(?<![\p{L}\p{N}_*])\*\*([^*\n]+?)\*\*(?![\p{L}\p{N}_*])|(?<![\p{L}\p{N}_])__([^_\n]+?)__(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])~~([^~\n]+?)~~(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_*])\*([^*\n]+?)\*(?![\p{L}\p{N}_*])|(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])|`([^`\n]+?)`/gu;
  let cursor = 0;
  let match = syntax.exec(text);
  while (match) {
    if (match.index > cursor) fragment.append(text.slice(cursor, match.index));
    const content = match.slice(1).find((part) => part !== undefined)!;
    const tag =
      match[1] || match[2]
        ? "strong"
        : match[3]
          ? "s"
          : match[4] || match[5]
            ? "em"
            : "code";
    const mark = document.createElement(tag);
    if (tag === "code") {
      mark.setAttribute("data-slide-authoring-format", "code");
    }
    mark.textContent = content;
    fragment.append(mark);
    cursor = match.index + match[0].length;
    match = syntax.exec(text);
  }
  if (cursor < text.length) fragment.append(text.slice(cursor));
}

function markdownTextLines(text: string): PastedLine[] | null {
  const rawLines = text.split(/\r\n|\r|\n/);
  if (
    !rawLines.some((line) =>
      /^\s*(?:[-*+]|\d+\.)\s+|^#{1,4}\s+|^>\s/.test(line),
    )
  ) {
    return null;
  }
  const lines: PastedLine[] = [];
  const lists: HTMLElement[] = [];
  for (const raw of rawLines) {
    const listMatch = /^(\s*)([-*+]|\d+\.)(?:\s+)(.*)$/.exec(raw);
    if (listMatch) {
      const indent = listMatch[1].replaceAll("\t", "    ").length;
      const depth = Math.min(8, Math.floor(indent / 2));
      const kind = /\d/.test(listMatch[2]) ? "OL" : "UL";
      let opened = false;
      if (lists.length > depth + 1) lists.length = depth + 1;
      while (lists.length <= depth) {
        lists.push(document.createElement(kind));
        if (lists.length - 1 === depth) opened = true;
      }
      if (lists[depth].tagName !== kind) {
        lists[depth] = document.createElement(kind);
        opened = true;
      }
      if (opened && kind === "OL" && Number(listMatch[2].slice(0, -1)) !== 1) {
        lists[depth].setAttribute("start", listMatch[2].slice(0, -1));
      }
      const fragment = document.createDocumentFragment();
      if (listMatch[3]) appendMarkdownInline(fragment, listMatch[3]);
      lines.push({
        fragment,
        lists: lists.slice(0, depth + 1),
        sourceItem: document.createElement("li"),
        blockTag: null,
      });
      continue;
    }
    lists.length = 0;
    const heading = /^(#{1,4})\s+(.*)$/.exec(raw);
    const quote = /^>\s?(.*)$/.exec(raw);
    const fragment = document.createDocumentFragment();
    const text = heading?.[2] ?? quote?.[1] ?? raw;
    if (text) appendMarkdownInline(fragment, text);
    lines.push({
      fragment,
      lists: [],
      sourceItem: null,
      blockTag: heading
        ? (`H${heading[1].length}` as PastedLine["blockTag"])
        : quote
          ? "BLOCKQUOTE"
          : null,
    });
  }
  return lines;
}

/** A slide list like a pasted one: its kind, marker, and numbering. */
function pastedListLike(source: HTMLElement): HTMLElement {
  const ordered = source.tagName === "OL";
  const list = createSlideList(document, ordered ? "ordered" : "bullet");
  if (!ordered) return list;
  const marker =
    source.style.getPropertyValue("list-style-type") ||
    ORDERED_TYPE_MARKER[source.getAttribute("type") ?? ""];
  if (marker) list.style.setProperty("list-style-type", marker);
  for (const name of ["start", "reversed", "type"]) {
    const value = source.getAttribute(name);
    if (value !== null) list.setAttribute(name, value);
  }
  return list;
}

/**
 * Pasted list lines as the lists they came from, nested the way they were:
 * a line opens a new list wherever its pasted list differs from the one open
 * at that depth, so an <ol> next to a <ul> stays two lists.
 */
function pastedLists(lines: PastedLine[]): DocumentFragment {
  const lists = document.createDocumentFragment();
  const open: { from: HTMLElement; list: HTMLElement }[] = [];
  const copiedItems = new WeakMap<HTMLElement, HTMLElement>();
  for (const { fragment, lists: from, sourceItem, blockTag } of lines) {
    let depth = 0;
    while (depth < open.length && open[depth].from === from[depth]) {
      depth += 1;
    }
    open.length = depth;
    while (open.length < from.length) {
      const source = from[open.length];
      const list = pastedListLike(source);
      const parent = open[open.length - 1]?.list;
      if (parent) {
        (
          parent.lastElementChild ??
          parent.appendChild(document.createElement("li"))
        ).append(list);
      } else {
        lists.append(list);
      }
      open.push({ from: source, list });
    }
    const currentList = open[open.length - 1].list;
    let item = sourceItem ? copiedItems.get(sourceItem) : undefined;
    if (!item || item.parentElement !== currentList) {
      item = document.createElement("li");
      currentList.append(item);
      if (sourceItem) copiedItems.set(sourceItem, item);
    }
    if (sourceItem && !item.hasChildNodes()) {
      const value = sourceItem.getAttribute("value");
      if (value !== null) item.setAttribute("value", value);
    }
    if (blockTag === "BLOCKQUOTE") {
      const quote = document.createElement("blockquote");
      quote.setAttribute("data-slide-authoring-format", "quote");
      const paragraph = document.createElement("p");
      paragraph.append(fragment);
      quote.append(paragraph);
      item.append(quote);
    } else if (blockTag === "P") {
      const paragraph = document.createElement("p");
      paragraph.append(fragment);
      item.append(paragraph);
    } else if (blockTag) {
      const block = document.createElement(blockTag.toLowerCase());
      block.append(fragment);
      item.append(block);
    } else {
      item.append(fragment);
    }
  }
  return lists;
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
  const initialRootTagName = el.tagName;
  let active = true;
  const initialContentEditable = el.getAttribute("contenteditable");
  const initialEditingBlock = el.getAttribute("data-editing-block");
  const startHtml = el.innerHTML;
  const startText = el.innerText;
  const startAttributes = new Map(
    Array.from(el.attributes, (attribute): [string, string] => [
      attribute.name,
      attribute.value,
    ]),
  );
  const restoreSessionMenuAria = () => {
    for (const name of SESSION_MENU_ARIA_ATTRIBUTES) {
      const value = startAttributes.get(name);
      if (value === undefined) el.removeAttribute(name);
      else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
  };
  // An author ZWSP is told apart from a placeholder by its place among the
  // element's ZWSPs, never by its text node: a split, a rebuild (a list
  // toggle, an undo), or Chrome's own typing makes new text nodes.
  let zwspText = el.textContent!;
  let authorZwsp = new Set(
    Array.from({ length: countZwsp(zwspText) }, (_, index) => index),
  );
  const undoStack: Snapshot[] = [];
  const redoStack: Snapshot[] = [];
  let lastEdit: {
    kind: EditKind;
    at: number;
    boundary: boolean;
    /** Where the edit left the selection; a run only continues from there. */
    after: TextOffsets | null;
  } | null = null;
  let focusSelection: TextOffsets | null = null;
  let pointerFocusPending = false;
  let edited = false;
  const enterCreatedListItems = new WeakSet<HTMLElement>();
  /** A drag-move's deletion, which its drop joins into one undo step. */
  let dragDeleted = false;
  /** The text a drag-move deleted from, reshaped once the drop has landed. */
  let dragSource: Node | null = null;
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

  /**
   * The author's ZWSPs, re-placed after a change. A change that adds or
   * removes ZWSPs does it in one place, between the text it left alone at
   * either end; any other change keeps every ZWSP in order.
   */
  function authorZwspOrdinals(): ReadonlySet<number> {
    const text = el.textContent!;
    if (text === zwspText) return authorZwsp;
    const before = countZwsp(zwspText);
    const delta = countZwsp(text) - before;
    if (delta !== 0) {
      const shortest = Math.min(text.length, zwspText.length);
      let head = 0;
      while (head < shortest && text[head] === zwspText[head]) head += 1;
      let tail = 0;
      while (
        tail < shortest - head &&
        text[text.length - 1 - tail] === zwspText[zwspText.length - 1 - tail]
      ) {
        tail += 1;
      }
      const kept = countZwsp(zwspText.slice(0, head));
      const shifted =
        before - countZwsp(zwspText.slice(zwspText.length - tail));
      authorZwsp = new Set(
        Array.from(authorZwsp).flatMap((ordinal) =>
          ordinal < kept
            ? [ordinal]
            : ordinal >= shifted
              ? [ordinal + delta]
              : [],
        ),
      );
    }
    zwspText = text;
    return authorZwsp;
  }

  /** Whether each ZWSP in `texts` (the element's, in order from the `first`th) is the author's. */
  function authorFlags(texts: Text[], first = 0): boolean[][] {
    const author = authorZwspOrdinals();
    let ordinal = first;
    return texts.map((text) =>
      Array.from({ length: countZwsp(text.data) }, () => author.has(ordinal++)),
    );
  }

  function placeholderFlags(text: Text) {
    if (!text.data.includes(ZERO_WIDTH_SPACE)) return null;
    const texts = textNodesIn(el);
    const index = texts.indexOf(text);
    return index < 0 ? null : authorFlags(texts)[index];
  }

  function isSessionPlaceholder(
    text: Text,
    offset: number,
    flags = placeholderFlags(text),
  ) {
    return (
      text.data[offset] === ZERO_WIDTH_SPACE &&
      flags?.[countZwsp(text.data.slice(0, offset))] === false
    );
  }

  function keepZwsp(data: string, flags: boolean[]) {
    let index = 0;
    return data.replaceAll(ZERO_WIDTH_SPACE, (char) =>
      flags[index++] ? char : "",
    );
  }

  /**
   * Chrome leaves joined scripts unreshaped after an edit. It also loses
   * kerning at a same-font text-node boundary, so recreate those Latin nodes
   * only when they have an adjacent run to kern with.
   */
  function hasSameFontTextAfter(text: Text) {
    let next = text.nextSibling;
    let parent = text.parentElement;
    while (!next && parent && parent !== el) {
      next = parent.nextSibling;
      parent = parent.parentElement;
    }
    if (!(next instanceof Text) || !next.data) return false;
    if (/\s/u.test(text.data.at(-1) ?? "") || /\s/u.test(next.data[0]))
      return false;
    const before = text.parentElement;
    const after = next.parentElement;
    if (!before || !after) return false;
    const a = window.getComputedStyle(before);
    const b = window.getComputedStyle(after);
    return (
      a.font === b.font &&
      a.fontKerning === b.fontKerning &&
      a.fontFeatureSettings === b.fontFeatureSettings &&
      a.fontVariationSettings === b.fontVariationSettings &&
      a.letterSpacing === b.letterSpacing
    );
  }

  function reshape(text: Node | null | undefined) {
    if (
      !(text instanceof Text) ||
      !text.isConnected ||
      (!/[^\t\n\r\u0020-\u024f\u2000-\u206f]/.test(text.data) &&
        !hasSameFontTextAfter(text))
    ) {
      return;
    }
    const range = selectionRange();
    // Read before replaceWith: the selection's live range moves with it.
    const caret =
      range?.collapsed && range.startContainer === text
        ? range.startOffset
        : null;
    const copy = text.cloneNode() as Text;
    text.replaceWith(copy);
    if (caret !== null) placeCaret(copy, caret);
  }

  function reshapeAtCaret() {
    const range = selectionRange();
    if (range?.collapsed) reshape(range.startContainer);
  }

  const notify = () => {
    authorZwspOrdinals();
    unscroll();
    focusSelection = selectionOffsets(true);
    if (lastEdit) lastEdit.after = focusSelection;
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
    const selection = window.getSelection();
    const range = selectionRange();
    if (!range) {
      return {
        from: 0,
        to: 0,
        fromBefore: false,
        toBefore: false,
        backward: false,
      };
    }
    const { startContainer, startOffset, endContainer, endOffset } = range;
    return {
      from: textOffset(el, startContainer, startOffset, breaks),
      to: textOffset(el, endContainer, endOffset, breaks),
      fromBefore: endsText(startContainer, startOffset),
      toBefore: endsText(endContainer, endOffset),
      backward:
        !range.collapsed &&
        selection?.anchorNode === endContainer &&
        selection.anchorOffset === endOffset,
    };
  }

  function select(
    start: readonly [Node, number],
    end: readonly [Node, number],
    backward = false,
  ) {
    const selection = window.getSelection();
    if (!selection) return;
    if (backward) {
      selection.setBaseAndExtent(end[0], end[1], start[0], start[1]);
      return;
    }
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function selectOffsets(
    { from, to, fromBefore, toBefore, backward }: TextOffsets,
    breaks = false,
  ) {
    select(
      textPoint(el, from, fromBefore, breaks),
      textPoint(el, to, toBefore, breaks),
      backward,
    );
  }

  function onBlur() {
    const range = selectionRange();
    if (range) focusSelection = selectionOffsets(true);
    else if (lastEdit?.after) focusSelection = lastEdit.after;
  }

  function onFocus() {
    if (!pointerFocusPending && active && focusSelection) {
      selectOffsets(focusSelection, true);
    }
    pointerFocusPending = false;
  }

  function onPointerDown() {
    pointerFocusPending = document.activeElement !== el;
  }

  function onPointerUp() {
    pointerFocusPending = false;
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
    if (points && intact) select(points[0], points[1], offsets.backward);
    else selectOffsets(offsets);
    return true;
  }

  function snapshot(): Snapshot {
    const tag = el.tagName;
    const attributes = Array.from(
      el.attributes,
      (attribute): [string, string] | null => {
        if (!SESSION_MENU_ARIA_ATTRIBUTES.has(attribute.name)) {
          return [attribute.name, attribute.value];
        }
        const initial = startAttributes.get(attribute.name);
        return initial === undefined ? null : [attribute.name, initial];
      },
    ).filter((attribute): attribute is [string, string] => attribute !== null);
    for (const name of SESSION_MENU_ARIA_ATTRIBUTES) {
      const initial = startAttributes.get(name);
      if (initial !== undefined && !attributes.some(([key]) => key === name)) {
        attributes.push([name, initial]);
      }
    }
    const html = el.innerHTML;
    return {
      tag,
      attributes,
      html,
      byteSize:
        utf8ByteLength(tag) +
        utf8ByteLength(html) +
        attributes.reduce(
          (size, [name, value]) =>
            size + utf8ByteLength(name) + utf8ByteLength(value),
          0,
        ) +
        64,
      authorZwsp: Array.from(authorZwspOrdinals()),
      ...selectionOffsets(true),
    };
  }

  function rootAttributesChanged() {
    const current = new Map(
      Array.from(el.attributes)
        .filter((attribute) => !SESSION_ROOT_ATTRIBUTES.has(attribute.name))
        .map((attribute): [string, string] => [
          attribute.name,
          attribute.value,
        ]),
    );
    const initial = Array.from(startAttributes).filter(
      ([name]) => !SESSION_ROOT_ATTRIBUTES.has(name),
    );
    return (
      current.size !== initial.length ||
      initial.some(([name, value]) => current.get(name) !== value)
    );
  }

  function trimHistory() {
    let bytes = [...undoStack, ...redoStack].reduce(
      (total, state) => total + state.byteSize,
      0,
    );
    while (
      undoStack.length + redoStack.length > IN_PLACE_TEXT_UNDO_LIMIT ||
      bytes > IN_PLACE_TEXT_UNDO_BYTE_LIMIT
    ) {
      // Keep the nearest undo and redo states when a large snapshot is evicted.
      const removed = undoStack.length ? undoStack.shift() : redoStack.shift();
      if (!removed) break;
      bytes -= removed.byteSize;
    }
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
    authorZwsp = new Set(state.authorZwsp);
    zwspText = el.textContent!;
    selectOffsets(state, true);
  }

  /** Records the pre-change state; a run of typing or deleting is one step. */
  function checkpoint(kind: EditKind, boundary = false, before = snapshot()) {
    edited = true;
    const now = Date.now();
    const selection = before;
    const coalesce =
      kind !== "command" &&
      lastEdit?.kind === kind &&
      !lastEdit.boundary &&
      now - lastEdit.at < TYPING_RUN_MS &&
      lastEdit.after?.from === selection.from &&
      lastEdit.after.to === selection.to &&
      lastEdit.after.fromBefore === selection.fromBefore &&
      lastEdit.after.toBefore === selection.toBefore &&
      lastEdit.after.backward === selection.backward;
    lastEdit = { kind, at: now, boundary, after: null };
    if (coalesce) return;
    redoStack.length = 0;
    undoStack.push(before);
    trimHistory();
  }

  function edit(kind: EditKind, mutate: () => void | boolean) {
    if (kind === "delete") {
      const before = snapshot();
      if (mutate() === false) return;
      checkpoint(kind, false, before);
    } else {
      checkpoint(kind);
      mutate();
    }
    reshapeAtCaret();
    notify();
  }

  function command(mutate: () => boolean): boolean {
    if (!active) return false;
    const before = snapshot();
    edited = true;
    lastEdit = {
      kind: "command",
      at: Date.now(),
      boundary: false,
      after: null,
    };
    if (!mutate()) return false;
    redoStack.length = 0;
    undoStack.push(before);
    trimHistory();
    notify();
    return true;
  }

  function undo() {
    const state = active ? undoStack.pop() : undefined;
    if (!state) return false;
    redoStack.push(snapshot());
    trimHistory();
    restore(state);
    lastEdit = null;
    notify();
    return true;
  }

  function redo() {
    const state = active ? redoStack.pop() : undefined;
    if (!state) return false;
    undoStack.push(snapshot());
    trimHistory();
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
    for (
      let row: HTMLElement | null = start;
      row && el.contains(row);
      row = row.parentElement
    ) {
      if (row.hasAttribute("data-slide-plain-row")) return row;
    }
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
    return row instanceof HTMLElement &&
      (isBulletRow(row) || row.hasAttribute("data-slide-plain-row"))
      ? row
      : null;
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
      if (startRow && endRow && startRow !== endRow) {
        joinRows(startRow, endRow);
      } else {
        let anchor: Node | null = null;
        if (startBlock.contains(endBlock)) {
          anchor = endBlock;
          while (anchor.parentNode !== startBlock) anchor = anchor.parentNode!;
        }
        const trailingLists =
          endBlock.tagName === "LI"
            ? Array.from(endBlock.children).filter(
                (child) => child.tagName === "OL" || child.tagName === "UL",
              )
            : [];
        const moved = Array.from(endBlock.childNodes).filter(
          (child) =>
            !trailingLists.includes(child as HTMLElement) &&
            !(child instanceof HTMLElement && isBulletMarker(child)),
        );
        for (const child of moved) {
          if (
            child instanceof HTMLElement &&
            child.tagName === startBlock.tagName &&
            ["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
              child.tagName,
            )
          ) {
            startBlock.append(...Array.from(child.childNodes));
          } else {
            startBlock.insertBefore(child, anchor);
          }
        }
        if (trailingLists.length > 0) {
          if (startBlock.tagName === "LI") {
            startBlock.append(...trailingLists);
          } else {
            startBlock.after(...trailingLists);
          }
        }
        let parent = endBlock.parentElement;
        endBlock.remove();
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
    }
    settleCaret(caretNode, caretOffset);
  }

  /**
   * Moves `from`'s text to the end of `into`'s, removes `from`, and returns
   * the join point. A run that matches the one it lands after is folded into
   * it, so joining two rows of one style leaves one span.
   */
  function joinRows(into: HTMLElement, from: HTMLElement): [Node, number] {
    const target = rowTextRange(into, rowMarker(into));
    const source = rowTextRange(from, rowMarker(from));
    const join = textOffset(into, target.endContainer, target.endOffset);
    const last = into.childNodes[target.endOffset - 1];
    const before = into.childNodes[target.endOffset] ?? null;
    const moved = Array.from(from.childNodes).slice(
      source.startOffset,
      source.endOffset,
    );
    const first = moved[0];
    if (
      last instanceof HTMLElement &&
      first instanceof HTMLElement &&
      target.intersectsNode(last) &&
      last.cloneNode(false).isEqualNode(first.cloneNode(false))
    ) {
      last.append(...Array.from(first.childNodes));
      moved.shift();
    }
    for (const node of moved) into.insertBefore(node, before);
    from.remove();
    return textPoint(into, join, true);
  }

  function mergeRows(into: HTMLElement, from: HTMLElement) {
    placeCaret(...joinRows(into, from));
  }

  function listItemContentRange(item: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(item);
    const nested = Array.from(item.children).find(
      (child) => child.tagName === "OL" || child.tagName === "UL",
    );
    if (nested) range.setEndBefore(nested);
    return range;
  }

  function selectedListItems(range: Range) {
    if (range.collapsed) {
      const item = listItemAt(range.startContainer);
      return item ? [item] : [];
    }
    const items = new Set<HTMLElement>();
    for (const text of textNodesIn(el)) {
      if (!range.intersectsNode(text)) continue;
      const item = listItemAt(text);
      if (item) items.add(item);
    }
    return Array.from(items);
  }

  function outdentSelectedListItems(items: HTMLElement[]) {
    return items.reduce((changed, item) => outdent(item) || changed, false);
  }

  function listItemTextEnd(item: HTMLElement): [Text, number] {
    const nested = Array.from(item.children).filter(
      (child) => child.tagName === "OL" || child.tagName === "UL",
    );
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!nested.some((list) => list.contains(node))) last = node as Text;
    }
    if (last) return [last, last.length];
    const placeholder = document.createTextNode(ZERO_WIDTH_SPACE);
    item.insertBefore(placeholder, nested[0] ?? null);
    return [placeholder, placeholder.length];
  }

  function joinListItems(into: HTMLElement, from: HTMLElement) {
    const caret = listItemTextEnd(into);
    const intoNested = Array.from(into.children).filter(
      (child) => child.tagName === "OL" || child.tagName === "UL",
    );
    const fromNested = Array.from(from.children).filter(
      (child) => child.tagName === "OL" || child.tagName === "UL",
    );
    const intoContent = Array.from(into.childNodes).filter(
      (child) => !intoNested.includes(child as HTMLElement),
    );
    const fromContent = Array.from(from.childNodes).filter(
      (child) => !fromNested.includes(child as HTMLElement),
    );
    const lastInto = intoContent.at(-1);
    const mergeable = (node: Node | undefined): node is HTMLElement =>
      node instanceof HTMLElement &&
      ["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(node.tagName);
    const mergedFrom = new Set<Node>();
    if (mergeable(lastInto)) {
      const firstBlockIndex = fromContent.findIndex(mergeable);
      const firstBlock = fromContent[firstBlockIndex];
      const inline =
        firstBlockIndex === -1
          ? fromContent
          : fromContent.slice(0, firstBlockIndex);
      if (inline.length > 0) {
        lastInto.append(...inline);
        inline.forEach((node) => mergedFrom.add(node));
        if (
          firstBlock instanceof HTMLElement &&
          !hasRenderedContent(firstBlock)
        ) {
          mergedFrom.add(firstBlock);
        }
      } else if (
        mergeable(firstBlock) &&
        firstBlock.tagName === lastInto.tagName
      ) {
        lastInto.append(...Array.from(firstBlock.childNodes));
        mergedFrom.add(firstBlock);
      }
    }
    for (const child of Array.from(from.childNodes)) {
      if (
        !fromNested.includes(child as HTMLElement) &&
        !mergedFrom.has(child)
      ) {
        into.insertBefore(child, intoNested[0] ?? null);
      }
    }
    let lastNested = intoNested.at(-1) ?? null;
    for (const nested of fromNested) {
      const matching = intoNested.find(
        (candidate) => candidate.tagName === nested.tagName,
      );
      if (matching) {
        matching.append(...Array.from(nested.childNodes));
        nested.remove();
      } else if (lastNested) {
        lastNested.after(nested);
        lastNested = nested;
      } else {
        into.append(nested);
        lastNested = nested;
      }
    }
    from.remove();
    placeCaret(...caret);
  }

  function deleteAtListItemEdge(caret: Range, direction: DeleteDirection) {
    const item = listItemAt(caret.startContainer);
    if (!item) return false;
    const content = listItemContentRange(item);
    const edge = document.createRange();
    if (direction === "backward") {
      edge.setStart(content.startContainer, content.startOffset);
      edge.setEnd(caret.startContainer, caret.startOffset);
    } else {
      edge.setStart(caret.startContainer, caret.startOffset);
      edge.setEnd(content.endContainer, content.endOffset);
    }
    if (hasRenderedContent(edge.cloneContents())) return false;

    const sibling =
      direction === "backward"
        ? item.previousElementSibling
        : item.nextElementSibling;
    if (direction === "backward") {
      if (hasRenderedContent(item)) {
        splitListItemToParagraph(item, false);
        return true;
      }
    } else if (sibling instanceof HTMLElement && sibling.tagName === "LI") {
      joinListItems(item, sibling);
      return true;
    } else {
      const list = item.parentElement;
      const next = list?.nextElementSibling;
      if (
        next instanceof HTMLElement &&
        isBlock(next) &&
        !STRUCTURAL_BLOCK_TAGS.has(next.tagName)
      ) {
        const point = listItemTextEnd(item);
        const current = item.lastElementChild;
        if (
          current instanceof HTMLElement &&
          current.tagName === next.tagName &&
          ["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
            current.tagName,
          )
        ) {
          current.append(...Array.from(next.childNodes));
        } else {
          item.append(...Array.from(next.childNodes));
        }
        next.remove();
        placeCaret(...point);
        return true;
      }
    }
    return false;
  }

  /**
   * Backspace first removes a styled row's marker. A later press joins it to
   * the previous row; Delete at its end still pulls the next one in.
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
    const text = rowTextRange(row, rowMarker(row));
    const edge = document.createRange();
    if (direction === "backward") {
      edge.setStart(text.startContainer, text.startOffset);
      edge.setEnd(caret.startContainer, caret.startOffset);
    } else {
      edge.setStart(caret.startContainer, caret.startOffset);
      edge.setEnd(text.endContainer, text.endOffset);
    }
    if (hasRenderedContent(edge.cloneContents())) return false;
    const index = rows.indexOf(row);
    if (direction === "backward" && !row.hasAttribute("data-slide-plain-row")) {
      rowMarker(row)?.remove();
      row.setAttribute("data-slide-plain-row", "true");
      return true;
    }
    if (direction === "backward" && index === 0) {
      const previous = row.previousElementSibling;
      if (
        previous instanceof HTMLElement &&
        !STRUCTURAL_BLOCK_TAGS.has(previous.tagName)
      ) {
        if (
          isBulletRow(previous) ||
          previous.hasAttribute("data-slide-plain-row")
        ) {
          mergeRows(previous, row);
        } else {
          appendBlockContents(previous, row);
        }
        return true;
      }
      return false;
    }
    const [into, from] =
      direction === "backward"
        ? [rows[index - 1], row]
        : [row, rows[index + 1]];
    if (into && from) mergeRows(into, from);
    return true;
  }

  function paragraphBefore(caret: Range, block: HTMLElement) {
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(caret.startContainer, caret.startOffset);
    return !hasRenderedContent(before.cloneContents());
  }

  function previousTextBlock(block: HTMLElement): HTMLElement | null {
    const previous = block.previousElementSibling;
    if (!(previous instanceof HTMLElement)) return null;
    if (previous.tagName === "UL" || previous.tagName === "OL") {
      let item = Array.from(previous.children).at(-1);
      while (item instanceof HTMLElement && item.tagName === "LI") {
        const nested = Array.from(item.children).find(
          (child) => child.tagName === "UL" || child.tagName === "OL",
        );
        if (!nested) return item;
        item = Array.from(nested.children).at(-1);
      }
      return null;
    }
    const rows = legacyRows(previous);
    if (rows.length) return rows.at(-1) ?? null;
    return previous;
  }

  function appendBlockContents(into: HTMLElement, from: HTMLElement) {
    const target =
      into.tagName === "LI"
        ? ((Array.from(into.children)
            .reverse()
            .find(
              (child) =>
                child instanceof HTMLElement &&
                ["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
                  child.tagName,
                ),
            ) as HTMLElement | undefined) ?? into)
        : into;
    const join = textOffset(target, target, target.childNodes.length);
    if (hasRenderedContent(from)) {
      if (from.tagName === "P" && ["P", "LI"].includes(target.tagName)) {
        target.append(...Array.from(from.childNodes));
      } else {
        target.append(from);
      }
    }
    from.remove();
    placeCaret(...textPoint(target, join, true));
  }

  function plainifyQuote(quote: HTMLElement) {
    if (quote === el) {
      const hasBlocks = Array.from(quote.children).some((child) =>
        isBlock(child),
      );
      retagRoot(hasBlocks ? "DIV" : "P");
      return;
    }
    const children = Array.from(quote.childNodes);
    if (
      children.some((child) => child instanceof HTMLElement && isBlock(child))
    ) {
      quote.replaceWith(...children);
    } else {
      const paragraph = document.createElement("p");
      paragraph.append(...children);
      quote.replaceWith(paragraph);
    }
  }

  function deleteAtBlockEdge(caret: Range, direction: DeleteDirection) {
    if (direction !== "backward") return false;
    let blockquote: HTMLElement | null = null;
    for (
      let current =
        caret.startContainer instanceof HTMLElement
          ? caret.startContainer
          : caret.startContainer.parentElement;
      current && current !== el && el.contains(current);
      current = current.parentElement
    ) {
      if (current.tagName === "BLOCKQUOTE") {
        blockquote = current;
        break;
      }
    }
    if (el.tagName === "BLOCKQUOTE") blockquote = el;
    const block = nearestBlock(caret.startContainer, el);
    const demote =
      blockquote ?? (/^H[1-6]$/.test(block.tagName) ? block : null);
    if (demote && paragraphBefore(caret, demote)) {
      if (demote.tagName === "BLOCKQUOTE") plainifyQuote(demote);
      else if (demote === el)
        retagRoot(initialRootTagName === "DIV" ? "DIV" : "P");
      else retagBlock(demote, "P");
      return true;
    }
    if (
      block.tagName !== "P" ||
      block === el ||
      !paragraphBefore(caret, block)
    ) {
      return false;
    }
    const previous = previousTextBlock(block);
    if (!previous) return false;
    if (previous.tagName === "HR") {
      previous.remove();
      return true;
    }
    if (
      previous.hasAttribute("data-slide-plain-row") ||
      isBulletRow(previous)
    ) {
      mergeRows(previous, block);
    } else {
      appendBlockContents(previous, block);
    }
    return true;
  }

  function deleteByInput(type: string, range: Range): boolean {
    if (!range.collapsed) {
      deleteRange(range);
      return true;
    }
    const step = DELETE_STEPS[type];
    if (!step) return false;
    const [direction, granularity] = step;
    if (deleteAtListItemEdge(range, direction)) return true;
    if (deleteAtRowEdge(range, direction)) return true;
    if (deleteAtBlockEdge(range, direction)) return true;
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
    if (extended && !extended.collapsed) {
      deleteRange(extended);
      return true;
    }
    return false;
  }

  /**
   * Whether a caret sits where a bullet row's text starts. Chrome takes that
   * spot and the end of the glyph before it for one position: it types into
   * the glyph, and End stays in the marker's inline-block, which ends there.
   */
  function atRowTextStart(range: Range) {
    const node = range.startContainer;
    if (!range.collapsed || !(node instanceof Text) || range.startOffset !== 0)
      return false;
    const row = bulletRowAt(node);
    const marker = row && rowMarker(row);
    if (!row || !marker || node.length === 0) return false;
    const text = rowTextRange(row, marker);
    return (
      textOffset(row, node, 0) ===
      textOffset(row, text.startContainer, text.startOffset)
    );
  }

  function isNativeInsert(range: Range) {
    const text = range.startContainer;
    return (
      range.collapsed &&
      text instanceof Text &&
      text.length > 0 &&
      !placeholderFlags(text)?.some((author) => !author) &&
      !atRowTextStart(range)
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
    const insertion = data === " " && emptyLineAtCaret(caret) ? "\u00a0" : data;
    const node = caret.startContainer;
    if (node instanceof Text) {
      let offset = caret.startOffset;
      const flags = placeholderFlags(node);
      for (const candidate of [offset - 1, offset]) {
        if (!isSessionPlaceholder(node, candidate, flags)) continue;
        node.deleteData(candidate, 1);
        if (candidate < offset) offset--;
        break;
      }
      node.insertData(offset, insertion);
      placeCaret(node, offset + insertion.length);
      return;
    }
    const text = document.createTextNode(insertion);
    caret.insertNode(text);
    placeCaret(text, insertion.length);
  }

  /** `<br>` plus, when nothing follows it, a placeholder that keeps the new line open. */
  function insertLineBreak(range: Range) {
    if (!range.collapsed) deleteRange(range);
    const caret = selectionRange();
    if (!caret) return;
    const br = document.createElement("br");
    caret.insertNode(br);
    if (hasRenderedContent(lineRest(br, nearestLineBox(br, el)))) {
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
    if (clone.tagName === "LI") clone.removeAttribute("value");
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
      let nested = Array.from(item.children).find(
        (child) => child.tagName === list.tagName,
      );
      if (!nested) {
        nested = list.cloneNode(false) as HTMLElement;
        stripCopiedIdentity(nested);
        item.append(nested);
      }
      nested.append(...following);
    }
    parentItem.after(item);
    if (list.children.length === 0) list.remove();
    return true;
  }

  function splitListItem(item: HTMLElement, caret: Range) {
    if (!hasRenderedContent(item)) {
      const list = item.parentElement;
      if (
        list &&
        (list.tagName === "OL" || list.tagName === "UL") &&
        list.parentElement?.tagName === "LI" &&
        keepingSelection(() => outdent(item))
      ) {
        return;
      }
      exitListItem(item);
      return;
    }
    splitBlock(item, caret);
    const current = selectionRange()?.startContainer;
    const currentItem = current ? listItemAt(current) : null;
    if (currentItem) {
      if (currentItem !== item) enterCreatedListItems.add(currentItem);
      for (const child of Array.from(currentItem.children)) {
        if (
          isBlock(child) &&
          !hasRenderedContent(child) &&
          !(current instanceof Node && child.contains(current))
        ) {
          child.remove();
        }
      }
    }
  }

  function orderedOrdinalAt(
    list: HTMLElement,
    items: HTMLElement[],
    index: number,
  ) {
    const reversed = list.hasAttribute("reversed");
    let ordinal = Number.parseInt(list.getAttribute("start") ?? "", 10);
    if (!Number.isFinite(ordinal)) ordinal = reversed ? items.length : 1;
    for (let at = 0; at < index; at += 1) {
      const override = Number.parseInt(
        items[at].getAttribute("value") ?? "",
        10,
      );
      if (Number.isFinite(override)) ordinal = override;
      ordinal += reversed ? -1 : 1;
    }
    const override = Number.parseInt(
      items[index]?.getAttribute("value") ?? "",
      10,
    );
    return Number.isFinite(override) ? override : ordinal;
  }

  function listSlice(
    list: HTMLElement,
    sourceItems: HTMLElement[],
    items: HTMLElement[],
    firstIndex: number,
    rootList = list === el,
  ) {
    if (items.length === 0) return null;
    const slice = rootList
      ? createSlideList(
          el.ownerDocument,
          list.tagName === "OL" ? "ordered" : "bullet",
        )
      : (list.cloneNode(false) as HTMLElement);
    if (rootList) {
      for (const property of [
        "list-style",
        "list-style-position",
        "list-style-type",
      ]) {
        const value = list.style.getPropertyValue(property);
        if (value) slice.style.setProperty(property, value);
      }
      for (const attribute of ["type", "reversed"]) {
        if (list.hasAttribute(attribute)) {
          slice.setAttribute(attribute, list.getAttribute(attribute)!);
        }
      }
    } else {
      stripCopiedIdentity(slice);
    }
    slice.removeAttribute("contenteditable");
    slice.removeAttribute("data-editing-block");
    slice.replaceChildren(...items);
    if (list.tagName === "OL") {
      slice.setAttribute(
        "start",
        String(orderedOrdinalAt(list, sourceItems, firstIndex)),
      );
    }
    return slice;
  }

  function changeListItemKind(
    item: HTMLElement,
    kind: SlideListKind,
    orderedStart?: number,
  ) {
    const source = item.parentElement;
    if (
      !(source instanceof HTMLElement) ||
      !["OL", "UL"].includes(source.tagName)
    ) {
      return false;
    }
    const targetTag = kind === "ordered" ? "OL" : "UL";
    const allItems = Array.from(source.children).filter(
      (child): child is HTMLElement => child.tagName === "LI",
    );
    const index = allItems.indexOf(item);
    if (index < 0) return false;
    if (source.tagName === targetTag) {
      if (targetTag === "OL" && orderedStart !== undefined) {
        item.setAttribute("value", String(orderedStart));
      }
      return true;
    }

    const before = allItems.slice(0, index);
    const after = allItems.slice(index + 1);
    const rootList = source === el;
    const template = source.cloneNode(false) as HTMLElement;
    const identity = rootList
      ? []
      : Array.from(template.attributes).filter(
          ({ name }) => name === "id" || /^data-.+-id$/.test(name),
        );
    if (rootList) {
      retagRoot("DIV");
      for (const property of [
        "list-style",
        "list-style-position",
        "list-style-type",
        "padding-left",
      ]) {
        el.style.removeProperty(property);
      }
      for (const attribute of ["start", "reversed", "type"]) {
        el.removeAttribute(attribute);
      }
    }
    const fragments: HTMLElement[] = [];
    if (before.length) {
      const leading = listSlice(template, allItems, before, 0, rootList);
      if (leading) fragments.push(leading);
    }

    let converted = rootList
      ? createSlideList(el.ownerDocument, kind)
      : document.createElement(targetTag);
    if (!rootList) {
      for (const attribute of Array.from(template.attributes)) {
        if (
          targetTag !== source.tagName &&
          ["start", "reversed", "type"].includes(attribute.name)
        ) {
          continue;
        }
        converted.setAttribute(attribute.name, attribute.value);
      }
    }
    stripCopiedIdentity(converted);
    converted.removeAttribute("contenteditable");
    converted.removeAttribute("data-editing-block");
    converted.replaceChildren(item);
    if (targetTag === "OL") {
      const start =
        orderedStart ??
        (source.tagName === "OL"
          ? orderedOrdinalAt(source, allItems, index)
          : 1);
      converted.setAttribute("start", String(start));
      converted.style.setProperty("list-style-type", "decimal");
      item.setAttribute("value", String(start));
    } else {
      converted.removeAttribute("start");
      converted.removeAttribute("reversed");
      converted.removeAttribute("type");
      converted.style.setProperty("list-style-type", "disc");
      item.removeAttribute("value");
    }
    fragments.push(converted);

    if (after.length) {
      const trailing = listSlice(
        template,
        allItems,
        after,
        index + 1,
        rootList,
      );
      if (trailing) {
        fragments.push(trailing);
      }
    }
    for (const attribute of identity) {
      fragments[0]?.setAttribute(attribute.name, attribute.value);
    }

    if (rootList) {
      el.replaceChildren(...fragments);
    } else {
      source.replaceWith(...fragments);
    }
    return true;
  }

  function splitListItemToParagraph(item: HTMLElement, empty: boolean) {
    const list = item.parentElement!;
    const nested = Array.from(item.children).filter(
      (child) => child.tagName === "OL" || child.tagName === "UL",
    );
    const content = Array.from(item.childNodes).filter(
      (child) => !nested.includes(child as HTMLElement),
    );
    const containsParagraph = content.some(
      (child) => child instanceof HTMLElement && child.tagName === "P",
    );
    let paragraph =
      content.length === 1 &&
      content[0] instanceof HTMLElement &&
      content[0].tagName === "P"
        ? content[0]
        : document.createElement(containsParagraph ? "div" : "p");
    if (paragraph !== content[0]) {
      for (const child of content) {
        if (
          child instanceof HTMLElement &&
          (/^H[1-6]$/.test(child.tagName) || child.tagName === "DIV")
        ) {
          paragraph.append(...Array.from(child.childNodes));
        } else {
          paragraph.append(child);
        }
      }
    }
    for (const attribute of Array.from(item.attributes)) {
      if (attribute.name === "value" || paragraph.hasAttribute(attribute.name))
        continue;
      paragraph.setAttribute(attribute.name, attribute.value);
    }
    for (const property of [
      "list-style",
      "list-style-position",
      "list-style-type",
      "padding-left",
    ]) {
      paragraph.style.removeProperty(property);
    }
    if (!paragraph.style.margin) paragraph.style.margin = "0";
    if (empty || !hasRenderedContent(paragraph)) {
      paragraph.replaceChildren(ZERO_WIDTH_SPACE);
    }

    const allItems = Array.from(list.children).filter(
      (child): child is HTMLElement => child.tagName === "LI",
    );
    const index = allItems.indexOf(item);
    const before = allItems.slice(0, index);
    const after = allItems.slice(index + 1);
    const numberedItems = enterCreatedListItems.has(item)
      ? allItems.filter((candidate) => candidate !== item)
      : allItems;
    const trailingIndex = numberedItems.indexOf(after[0]!);
    const wasRoot = list === el;
    const makeSlice = (
      items: HTMLElement[],
      firstIndex: number,
      sourceItems = allItems,
    ) => listSlice(list, sourceItems, items, firstIndex);
    const leading = wasRoot ? makeSlice(before, 0) : null;
    const trailing =
      after.length && (wasRoot || before.length)
        ? makeSlice(after, trailingIndex, numberedItems)
        : null;

    if (wasRoot) {
      retagRoot("DIV");
      el.style.removeProperty("list-style-type");
      el.style.removeProperty("list-style-position");
      el.style.removeProperty("padding-left");
      el.removeAttribute("start");
      el.removeAttribute("reversed");
      el.removeAttribute("type");
      el.replaceChildren(
        ...(leading ? [leading] : []),
        paragraph,
        ...nested,
        ...(trailing ? [trailing] : []),
      );
    } else if (before.length && after.length) {
      list.replaceChildren(...before);
      if (list.tagName === "OL") {
        list.setAttribute(
          "start",
          String(orderedOrdinalAt(list, numberedItems, 0)),
        );
      }
      list.after(paragraph, ...nested, trailing!);
    } else if (before.length) {
      item.remove();
      if (list.tagName === "OL") {
        list.setAttribute("start", String(orderedOrdinalAt(list, allItems, 0)));
      }
      list.after(paragraph, ...nested);
    } else if (after.length) {
      item.remove();
      if (list.tagName === "OL") {
        list.setAttribute(
          "start",
          String(orderedOrdinalAt(list, numberedItems, trailingIndex)),
        );
      }
      list.before(paragraph, ...nested);
    } else {
      list.replaceWith(paragraph, ...nested);
    }
    placeCaret(...textPoint(paragraph, empty ? Infinity : 0));
  }

  function exitListItem(item: HTMLElement) {
    splitListItemToParagraph(item, true);
  }

  function quoteAt(node: Node): HTMLElement | null {
    for (
      let current = node instanceof HTMLElement ? node : node.parentElement;
      current && current !== el && el.contains(current);
      current = current.parentElement
    ) {
      if (current.tagName === "BLOCKQUOTE") return current;
    }
    return el.tagName === "BLOCKQUOTE" ? el : null;
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
    const quote = quoteAt(caret.startContainer);
    if (quote) {
      const block = nearestBlock(caret.startContainer, quote);
      const blockContent = block.cloneNode(true) as HTMLElement;
      blockContent.querySelectorAll("br").forEach((br) => br.remove());
      if (!hasRenderedContent(blockContent)) {
        const paragraph = document.createElement("p");
        paragraph.append(ZERO_WIDTH_SPACE);
        if (quote === el) {
          if (block === quote) {
            retagRoot("P");
            el.replaceChildren(paragraph.firstChild!);
            placeCaret(...textPoint(el, Infinity));
            return;
          }
          const children = Array.from(quote.childNodes);
          const index = children.indexOf(block);
          const before = children.slice(0, index);
          const after = children.slice(index + 1);
          if (!before.length && !after.length) {
            retagRoot("P");
            el.replaceChildren(paragraph.firstChild!);
            placeCaret(...textPoint(el, Infinity));
            return;
          }
          const wrap = (nodes: Node[]) => {
            if (!nodes.length) return null;
            const wrapper = quote.cloneNode(false) as HTMLElement;
            stripCopiedIdentity(wrapper);
            wrapper.removeAttribute("contenteditable");
            wrapper.removeAttribute("data-editing-block");
            wrapper.append(...nodes);
            return wrapper;
          };
          const leading = wrap(before);
          const trailing = wrap(after);
          retagRoot("DIV");
          el.replaceChildren(
            ...(leading ? [leading] : []),
            paragraph,
            ...(trailing ? [trailing] : []),
          );
        } else {
          if (block === quote) {
            quote.replaceWith(paragraph);
          } else {
            const children = Array.from(quote.childNodes);
            const index = children.indexOf(block);
            const before = children.slice(0, index);
            const after = children.slice(index + 1);
            if (before.length) {
              const trailing = after.length
                ? (quote.cloneNode(false) as HTMLElement)
                : null;
              if (trailing) {
                stripCopiedIdentity(trailing);
                trailing.append(...after);
              }
              quote.replaceChildren(...before);
              quote.after(paragraph, ...(trailing ? [trailing] : []));
            } else if (after.length) {
              quote.replaceChildren(...after);
              quote.before(paragraph);
            } else {
              quote.replaceWith(paragraph);
            }
          }
        }
        placeCaret(...textPoint(paragraph, Infinity));
        return;
      }
    }
    const row = legacyRowAt(caret.startContainer);
    if (row) {
      const list = row.parentElement!;
      const rows = legacyRows(list);
      if (row === rows[rows.length - 1] && isEmptyRow(row)) {
        const paragraph = document.createElement("div");
        paragraph.append(ZERO_WIDTH_SPACE);
        row.remove();
        if (list === el) el.append(paragraph);
        else if (list.children.length === 0) list.replaceWith(paragraph);
        else list.after(paragraph);
        placeCaret(...textPoint(paragraph, Infinity));
        return;
      }
      if (insertBulletAfterCaret(list)) return;
    }
    const block = nearestBlock(caret.startContainer, el);
    if (/^H[1-6]$/.test(block.tagName)) {
      const after = document.createRange();
      after.setStart(caret.startContainer, caret.startOffset);
      after.setEnd(block, block.childNodes.length);
      if (!hasRenderedContent(after.cloneContents())) {
        let heading = block;
        if (heading === el) {
          heading = promoteRootLines(caret);
        }
        const paragraph = document.createElement("p");
        paragraph.append(ZERO_WIDTH_SPACE);
        heading.after(paragraph);
        placeCaret(...textPoint(paragraph, Infinity));
        return;
      }
    }
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

  function insertBlockClipboard(lines: PastedLine[], at: Range) {
    if (!at.collapsed) deleteRange(at);
    let caret = selectionRange();
    if (!caret) return false;

    const blocks = document.createDocumentFragment();
    for (let index = 0; index < lines.length; ) {
      const line = lines[index];
      if (line.lists.length) {
        let end = index + 1;
        while (end < lines.length && lines[end].lists.length) end += 1;
        blocks.append(pastedLists(lines.slice(index, end)));
        index = end;
        continue;
      }
      const tag = line.blockTag?.toLowerCase() ?? "p";
      const block = document.createElement(tag);
      if (tag === "blockquote") {
        block.setAttribute("data-slide-authoring-format", "quote");
        const paragraph = document.createElement("p");
        paragraph.append(line.fragment);
        block.append(paragraph);
      } else {
        block.append(line.fragment);
      }
      blocks.append(block);
      index += 1;
    }
    const last = blocks.lastChild;
    if (!(last instanceof HTMLElement)) return false;

    let block = commandBlock(caret.startContainer);
    if (block === el && rootHasLineBreak(el)) {
      block = promoteRootLines(caret);
      caret = selectionRange()!;
    }

    if (block === el) {
      if (!hasRenderedContent(el)) {
        if (el.tagName !== "DIV") retagRoot("DIV");
        el.replaceChildren(blocks);
        placeCaret(el, el.childNodes.length);
        return true;
      }
      if (caret.startContainer === el) {
        caret.insertNode(blocks);
        placeCaret(el, Array.from(el.childNodes).indexOf(last) + 1);
        return true;
      }

      const rootTag = el.tagName.toLowerCase();
      const look = headingTextLook(el);
      if (el.tagName !== "DIV") retagRoot("DIV");
      caret = selectionRange()!;
      const suffixRange = document.createRange();
      suffixRange.setStart(caret.startContainer, caret.startOffset);
      suffixRange.setEnd(el, el.childNodes.length);
      const suffix = extractWithoutCopiedIdentity(suffixRange);
      const before = document.createElement(rootTag);
      before.append(...Array.from(el.childNodes));
      const after = document.createElement(rootTag);
      after.append(suffix);
      keepTextLook(before, look);
      keepTextLook(after, look);
      const continuation = hasRenderedContent(after) ? after : null;
      el.replaceChildren(
        ...(hasRenderedContent(before) ? [before] : []),
        blocks,
        ...(continuation ? [continuation] : []),
      );
      placeCaret(
        ...(continuation
          ? textPoint(continuation, 0)
          : textPoint(last, Infinity)),
      );
      return true;
    }

    if (block.tagName === "LI") {
      caret.insertNode(blocks);
      placeCaret(...textPoint(last, Infinity));
      return true;
    }

    splitBlock(block, caret);
    const continuation = block.nextElementSibling;
    if (!(continuation instanceof HTMLElement)) {
      throw new Error(
        "in-place text session: block paste lost its continuation",
      );
    }
    continuation.before(blocks);
    if (hasRenderedContent(continuation)) {
      placeCaret(...textPoint(continuation, 0));
    } else {
      continuation.remove();
      placeCaret(...textPoint(last, Infinity));
    }
    return true;
  }

  /**
   * Pasted list items stay list items where the caret can hold them: in a
   * list item they become items at their own depth, and in a container that
   * may hold a list they arrive as one. A paragraph or heading cannot hold a
   * list, so there they are lines like any other paste. A paste with nothing
   * left to insert (an image the allowlist drops) changes nothing, not even
   * the selection it would have replaced.
   */
  function insertClipboard(data: DataTransfer, at: Range): boolean {
    const html = data.getData("text/html");
    const normalized = html ? normalizeSlideClipboardHtml(html) : null;
    const text = data.getData("text/plain");
    const markdown = normalized === null ? markdownTextLines(text) : null;
    const preserveSlideStyles = data.getData(SLIDE_CLIPBOARD_TYPE) === "1";
    const lines =
      normalized !== null
        ? pastedHtmlLines(normalized, preserveSlideStyles)
        : (markdown ?? plainTextLines(text));
    if (
      normalized !== null
        ? lines.every(({ fragment }) => !hasRenderedContent(fragment))
        : !text
    ) {
      return false;
    }
    const pastedUrl = text.trim();
    if (at && !at.collapsed && /^(?:https?:\/\/|mailto:)/i.test(pastedUrl)) {
      if (URL.canParse(pastedUrl)) {
        const url = new URL(pastedUrl);
        if (SAFE_LINK.test(url.protocol)) {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(at);
          return setInlineTextLink(el, url.href).scope === "selection";
        }
      }
    }
    if (markdown) return insertBlockClipboard(lines, at);
    if (normalized !== null && lines.some(({ blockTag }) => blockTag)) {
      return insertBlockClipboard(lines, at);
    }
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
      const lists = pastedLists(lines);
      const last = lists.lastChild!;
      caret.insertNode(lists);
      placeCaret(...textPoint(last, Infinity));
      return true;
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
            // A sub-list this line opened is the pasted one, not the host's.
            const list = current.parentElement!;
            if (list.childElementCount === 1) {
              const like = pastedListLike(line.lists[depth - 1]);
              keepingSelection(() => {
                list.replaceWith(like);
                like.append(current);
                return true;
              });
            }
          }
          while (depth > target && keepingSelection(() => outdent(current))) {
            depth -= 1;
          }
        }
      }
      insertFragment(line.fragment);
    });
    return true;
  }

  function caretAtOrAfter(caret: Range, point: Range) {
    return caret.compareBoundaryPoints(Range.START_TO_START, point) >= 0;
  }

  function linePrefix(block: HTMLElement, caret: Range) {
    let start: [Node, number] = [block, 0];
    if (isBulletRow(block)) {
      const marker =
        block.firstElementChild instanceof HTMLElement &&
        isBulletMarker(block.firstElementChild)
          ? block.firstElementChild
          : null;
      const text = rowTextRange(block, marker);
      start = [text.startContainer, text.startOffset];
    }

    for (const br of Array.from(block.querySelectorAll("br"))) {
      const parent = br.parentNode!;
      const after = Array.from(parent.childNodes).indexOf(br) + 1;
      const breakEnd = document.createRange();
      breakEnd.setStart(parent, after);
      breakEnd.collapse(true);
      if (caretAtOrAfter(caret, breakEnd)) {
        start = [parent, after];
      }
    }

    const prefix = document.createRange();
    prefix.setStart(...start);
    prefix.setEnd(caret.startContainer, caret.startOffset);
    return prefix;
  }

  function emptyLineAtCaret(caret: Range) {
    const line = nearestLineBox(caret.startContainer, el);
    const prefix = linePrefix(line, caret);
    const suffix = document.createRange();
    suffix.setStart(caret.startContainer, caret.startOffset);
    suffix.setEnd(line, line.childNodes.length);
    const hasContent = (fragment: DocumentFragment) =>
      !!fragment.textContent?.replaceAll(ZERO_WIDTH_SPACE, "") ||
      fragment.querySelector("img,svg,video,canvas,picture,iframe,input,hr") !==
        null;
    return (
      !hasContent(prefix.cloneContents()) && !hasContent(suffix.cloneContents())
    );
  }

  function hasLineBreakBefore(block: HTMLElement, caret: Range) {
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(caret.startContainer, caret.startOffset);
    return Array.from(block.querySelectorAll("br")).some((br) =>
      before.intersectsNode(br),
    );
  }

  function lineIndexAt(root: HTMLElement, caret: Range) {
    return Array.from(root.querySelectorAll("br")).filter((br) => {
      const parent = br.parentNode!;
      const breakEnd = document.createRange();
      breakEnd.setStart(parent, Array.from(parent.childNodes).indexOf(br) + 1);
      breakEnd.collapse(true);
      return caretAtOrAfter(caret, breakEnd);
    }).length;
  }

  function rootHasLineBreak(root: HTMLElement) {
    return root.querySelector("br") !== null;
  }

  function blockHasLineBreak(block: HTMLElement) {
    return Array.from(block.querySelectorAll("br")).some((br) => {
      for (
        let ancestor = br.parentElement;
        ancestor && ancestor !== block;
        ancestor = ancestor.parentElement
      ) {
        if (["LI", "OL", "UL"].includes(ancestor.tagName)) return false;
      }
      return true;
    });
  }

  function splitRootLines(root: HTMLElement) {
    const lines: Node[][] = [[]];
    const copied = new WeakSet<Element>();
    const splitNode = (node: Node): Node[][] => {
      if (node instanceof HTMLBRElement) return [[], []];
      if (node instanceof Text) return [[node.cloneNode(true)]];
      if (!(node instanceof HTMLElement)) return [[]];
      const childLines: Node[][] = [[]];
      for (const child of Array.from(node.childNodes)) {
        const parts = splitNode(child);
        for (const [index, part] of parts.entries()) {
          if (index > 0) childLines.push([]);
          childLines.at(-1)!.push(...part);
        }
      }
      return childLines.map((children) => {
        const clone = node.cloneNode(false) as HTMLElement;
        if (copied.has(node)) stripCopiedIdentity(clone);
        else copied.add(node);
        clone.append(...children);
        return [clone];
      });
    };

    for (const child of Array.from(root.childNodes)) {
      const parts = splitNode(child);
      for (const [index, part] of parts.entries()) {
        if (index > 0) lines.push([]);
        lines.at(-1)!.push(...part);
      }
    }
    return lines;
  }

  /** Turn root-level BR lines into editable child blocks before changing one line. */
  function promoteRootLines(
    caret: Range,
    commandKind?: InPlaceTextAuthoringCommand,
  ) {
    const index = lineIndexAt(el, caret);
    const offset = linePrefix(el, caret).toString().length;
    const textLook = authoredTextLook(el);
    const offsets = selectionOffsets();
    const sourceTag = el.tagName;
    const computed = window.getComputedStyle(el);
    const lineTag = [
      "P",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "BLOCKQUOTE",
    ].includes(el.tagName)
      ? el.tagName.toLowerCase()
      : "div";
    const targetTag =
      commandKind === "paragraph"
        ? "P"
        : commandKind === "quote"
          ? sourceTag === "BLOCKQUOTE"
            ? "P"
            : "BLOCKQUOTE"
          : commandKind?.startsWith("heading")
            ? sourceTag === `H${commandKind.slice(-1)}`
              ? "P"
              : `H${commandKind.slice(-1)}`
            : null;
    const lines = splitRootLines(el).map((children, lineIndex) => {
      const block = document.createElement(lineTag);
      block.append(...children);
      if (block.childNodes.length === 0) block.append(ZERO_WIDTH_SPACE);
      block.style.margin = "0";
      if (lineIndex !== index || !targetTag || targetTag === lineTag) {
        applyTextLook(block, textLook);
      }
      return block;
    });
    if (el.tagName !== "DIV") retagRoot("DIV");
    el.replaceChildren(...lines);
    for (const property of TEXT_LOOK_PROPERTIES) {
      el.style.removeProperty(property);
    }
    for (const property of [
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
    ]) {
      const value = computed.getPropertyValue(property);
      if (value) el.style.setProperty(property, value);
    }
    selectOffsets(offsets);
    const target = lines[Math.min(index, lines.length - 1)] ?? el;
    if (offsets.from === offsets.to) placeCaret(...textPoint(target, offset));
    return target;
  }

  function promoteBlockLines(block: HTMLElement, caret: Range) {
    const index = lineIndexAt(block, caret);
    const offset = linePrefix(block, caret).toString().length;
    const look = headingTextLook(block);
    const lines = splitRootLines(block);
    const promoted = lines.map((children, lineIndex) => {
      const line =
        lineIndex === 0 ? block : (block.cloneNode(false) as HTMLElement);
      if (lineIndex > 0) stripCopiedIdentity(line);
      line.replaceChildren(...children);
      if (line.childNodes.length === 0) line.append(ZERO_WIDTH_SPACE);
      keepTextLook(line, look);
      return line;
    });
    block.after(...promoted.slice(1));
    const target = promoted[Math.min(index, promoted.length - 1)] ?? block;
    placeCaret(...textPoint(target, offset));
    return target;
  }

  function commandBlock(node: Node) {
    const block = nearestBlock(node, el);
    if (block.tagName !== "LI") return block;
    return (
      Array.from(block.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          BLOCK_TAGS.has(child.tagName) &&
          child.tagName !== "OL" &&
          child.tagName !== "UL",
      ) ?? block
    );
  }

  function selectAllBlockOrEditable() {
    const range = selectionRange();
    const block = range ? commandBlock(range.startContainer) : el;
    if (block === el) return selectAllEditableText(el);

    const selection = window.getSelection();
    if (!selection) return false;
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    const alreadySelected =
      !!range &&
      !range.collapsed &&
      range.compareBoundaryPoints(Range.START_TO_START, blockRange) === 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, blockRange) === 0;
    if (alreadySelected) return selectAllEditableText(el);

    el.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(blockRange);
    return true;
  }

  function retagBlock(block: HTMLElement, tagName: string) {
    if (block === el) {
      if (block.tagName !== tagName) retagRoot(tagName);
      return;
    }
    if (block.tagName === "LI") {
      const lists = Array.from(block.children).filter(
        (child) => child.tagName === "OL" || child.tagName === "UL",
      );
      const content = document.createElement(tagName);
      const moved = Array.from(block.childNodes).filter(
        (child) => !lists.includes(child as HTMLElement),
      );
      content.append(...moved);
      block.insertBefore(content, lists[0] ?? null);
      return;
    }
    if (block.tagName !== tagName) retag(block, tagName);
  }

  function materializeRootInlineBlocks() {
    const groups: Node[][] = [];
    let group: Node[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (
        child instanceof HTMLElement &&
        (BLOCK_TAGS.has(child.tagName) || child.tagName === "HR")
      ) {
        if (group.length) groups.push(group);
        group = [];
      } else {
        group.push(child);
      }
    }
    if (group.length) groups.push(group);
    const tagName = /^H[1-6]$/.test(el.tagName) ? el.tagName : "P";
    const look = sourceTextLook(el);
    for (const nodes of groups) {
      const first = nodes[0];
      const block = document.createElement(tagName.toLowerCase());
      block.style.margin = "0";
      keepTextLook(block, look);
      first.parentNode?.insertBefore(block, first);
      block.append(...nodes);
    }
    if (
      groups.length &&
      ["P", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
        el.tagName,
      )
    ) {
      retagRoot("DIV");
    }
  }

  function unwrapBulletRowForBlockCommand(block: HTMLElement) {
    const marker = rowMarker(block);
    marker?.remove();
    for (const property of [
      "display",
      "gap",
      "column-gap",
      "row-gap",
      "flex",
      "flex-direction",
      "flex-wrap",
      "align-items",
      "justify-content",
    ]) {
      block.style.removeProperty(property);
    }
  }

  function canMergeAdjacentLists(left: HTMLElement, right: HTMLElement) {
    if (left.tagName !== right.tagName || right.hasAttribute("id"))
      return false;
    if (
      left.tagName === "OL" &&
      (left.hasAttribute("reversed") ||
        right.hasAttribute("reversed") ||
        right.hasAttribute("start"))
    ) {
      return false;
    }
    const attributes = (list: HTMLElement) =>
      Array.from(list.attributes)
        .filter((attribute) => attribute.name !== "id")
        .map((attribute) => `${attribute.name}\0${attribute.value}`)
        .sort();
    return attributes(left).join("\0") === attributes(right).join("\0");
  }

  function mergeAdjacentLists(list: HTMLElement) {
    let target = list;
    const previous = target.previousElementSibling;
    if (
      previous instanceof HTMLElement &&
      canMergeAdjacentLists(previous, target)
    ) {
      previous.append(...Array.from(target.childNodes));
      target.remove();
      target = previous;
    }
    const next = target.nextElementSibling;
    if (next instanceof HTMLElement && canMergeAdjacentLists(target, next)) {
      target.append(...Array.from(next.childNodes));
      next.remove();
    }
  }

  function toggleListAtBlock(block: HTMLElement, kind: SlideListKind): boolean {
    return keepingSelection(() => {
      if (
        block === el &&
        Array.from(el.childNodes).some(
          (child) =>
            child instanceof HTMLElement &&
            (BLOCK_TAGS.has(child.tagName) || child.tagName === "HR"),
        ) &&
        Array.from(el.childNodes).some(
          (child) =>
            !(child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName)),
        )
      ) {
        materializeRootInlineBlocks();
        const caret = selectionRange();
        if (caret) {
          const target = commandBlock(caret.startContainer);
          if (target !== el) return toggleListAtBlock(target, kind);
        }
      }
      if (isBulletRow(block) && block !== el) {
        if (kind === "bullet") {
          rowMarker(block)?.remove();
          return true;
        }
        unwrapBulletRowForBlockCommand(block);
        const list = createSlideList(document, kind);
        const item = retag(block, "LI");
        item.replaceWith(list);
        list.append(item);
        return true;
      }
      if (block === el || (block === el && isBulletRow(block))) {
        if (!hasRenderedContent(el)) el.prepend(ZERO_WIDTH_SPACE);
        const look = blockTextLook(el);
        const margins = blockMargins(el);
        const next = toggleSlideList(el, kind);
        if (!next) return false;
        keepTextLook(next, look);
        applyBlockMargins(next, margins);
        if (next !== el) rebind(next);
        return true;
      }

      const item = listItemAt(block);
      if (item) {
        const list = item.parentElement!;
        const tagName = kind === "ordered" ? "OL" : "UL";
        if (list.tagName === tagName) {
          splitListItemToParagraph(item, false);
          return true;
        }
        const replacement = retag(list, tagName);
        replacement.style.setProperty(
          "list-style-type",
          kind === "ordered" ? "decimal" : "disc",
        );
        if (list === el) rebind(replacement);
        return true;
      }

      const list = createSlideList(document, kind);
      preserveBlockMargins(block, list);
      const look = sourceTextLook(block);
      const line = block.tagName === "LI" ? block : retag(block, "LI");
      keepTextLook(line, look);
      line.replaceWith(list);
      list.append(line);
      mergeAdjacentLists(list);
      return true;
    });
  }

  function insertDividerAtBlock(block: HTMLElement, caret: Range) {
    if (block === el) {
      const before = document.createRange();
      before.setStart(el, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      const after = document.createRange();
      after.setStart(caret.startContainer, caret.startOffset);
      after.setEnd(el, el.childNodes.length);
      const sourceTag = el.tagName;
      const look = sourceTextLook(el);
      const rootMargins = window.getComputedStyle(el);
      const afterContent = extractWithoutCopiedIdentity(after);
      const beforeContent = extractWithoutCopiedIdentity(before);
      const leading = document.createElement(
        /^H[1-6]$/.test(sourceTag) ? sourceTag.toLowerCase() : "p",
      );
      leading.style.margin = "0";
      keepTextLook(leading, look);
      leading.append(beforeContent);
      const hasLeading = hasRenderedContent(leading);
      if (!hasLeading) leading.remove();
      if (el.tagName !== "DIV") retagRoot("DIV");
      for (const property of [
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
      ]) {
        const value = rootMargins.getPropertyValue(property);
        if (value) el.style.setProperty(property, value);
      }
      const divider = document.createElement("hr");
      const paragraph = document.createElement("p");
      paragraph.style.margin = "0";
      paragraph.append(afterContent);
      if (!hasRenderedContent(paragraph)) paragraph.prepend(ZERO_WIDTH_SPACE);
      el.replaceChildren(...(hasLeading ? [leading] : []), divider, paragraph);
      placeCaret(...textPoint(paragraph, 0));
      return;
    }
    if (block.tagName !== "LI" && !hasRenderedContent(block)) {
      block.before(document.createElement("hr"));
      placeCaret(...textPoint(block, 0));
      return;
    }
    if (block.tagName === "LI") {
      const content = listItemContentRange(block);
      const before = document.createRange();
      before.setStart(block, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      const after = document.createRange();
      after.setStart(caret.startContainer, caret.startOffset);
      after.setEnd(content.endContainer, content.endOffset);
      const trailingLists = Array.from(block.children).filter(
        (child) => child.tagName === "OL" || child.tagName === "UL",
      );
      const left = document.createElement("p");
      const right = document.createElement("p");
      const afterContent = extractWithoutCopiedIdentity(after);
      const beforeContent = extractWithoutCopiedIdentity(before);
      left.append(beforeContent);
      right.append(afterContent);
      if (!hasRenderedContent(right)) right.append(ZERO_WIDTH_SPACE);
      const divider = document.createElement("hr");
      block.replaceChildren(left, divider, right, ...trailingLists);
      placeCaret(...textPoint(right, 0));
      return;
    }
    splitBlock(block, caret);
    block.after(document.createElement("hr"));
  }

  function applyAuthoringCommandAtBlock(
    kind: InPlaceTextAuthoringCommand,
    block: HTMLElement,
    caret: Range,
  ) {
    if (
      isBulletRow(block) &&
      block !== el &&
      kind !== "bulletList" &&
      kind !== "orderedList"
    ) {
      unwrapBulletRowForBlockCommand(block);
    }
    switch (kind) {
      case "paragraph":
        if (block.tagName === "LI" || block.tagName === "P") {
          const item = block.tagName === "LI" ? block : listItemAt(block);
          if (item) {
            splitListItemToParagraph(item, false);
            break;
          }
          retagBlock(block, "P");
          break;
        }
        retagBlock(block, "P");
        break;
      case "heading1":
      case "heading2":
      case "heading3":
      case "heading4": {
        const tagName = `H${kind.slice(-1)}`;
        retagBlock(block, block.tagName === tagName ? "P" : tagName);
        break;
      }
      case "bulletList":
        return toggleListAtBlock(block, "bullet");
      case "orderedList":
        return toggleListAtBlock(block, "ordered");
      case "quote":
        retagBlock(block, block.tagName === "BLOCKQUOTE" ? "P" : "BLOCKQUOTE");
        break;
      case "divider":
        insertDividerAtBlock(block, caret);
        break;
    }
    return true;
  }

  function selectedCommandBlocks(range: Range) {
    const blocks = new Set<HTMLElement>();
    for (const text of textNodesIn(el)) {
      if (range.intersectsNode(text)) blocks.add(commandBlock(text));
    }
    return Array.from(blocks).sort((left, right) =>
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
  }

  function applyAuthoringCommandToBlocks(
    kind: InPlaceTextAuthoringCommand,
    blocks: HTMLElement[],
  ) {
    if (kind === "divider" || kind === "bulletList" || kind === "orderedList") {
      return false;
    }
    const headingTag =
      kind === "heading1" ||
      kind === "heading2" ||
      kind === "heading3" ||
      kind === "heading4"
        ? `H${kind.slice(-1)}`
        : null;
    const tagName =
      kind === "quote"
        ? blocks.every((block) => block.tagName === "BLOCKQUOTE")
          ? "P"
          : "BLOCKQUOTE"
        : headingTag
          ? blocks.every((block) => block.tagName === headingTag)
            ? "P"
            : headingTag
          : kind === "paragraph"
            ? "P"
            : null;
    if (!tagName) return false;
    return keepingSelection(() => {
      for (const block of blocks) {
        if (isBulletRow(block) && block !== el) {
          unwrapBulletRowForBlockCommand(block);
        }
        retagBlock(block, tagName);
      }
      return true;
    });
  }

  function applyAuthoringCommand(
    kind: InPlaceTextAuthoringCommand,
    slashRange?: Range,
  ) {
    return command(() => {
      if (
        slashRange &&
        (!el.contains(slashRange.startContainer) ||
          !el.contains(slashRange.endContainer))
      ) {
        return false;
      }
      if (slashRange) deleteRange(slashRange);
      const caret = selectionRange();
      if (!caret) return false;
      let block = commandBlock(caret.startContainer);
      if (!caret.collapsed && commandBlock(caret.endContainer) !== block) {
        if (slashRange) return false;
        let blocks = selectedCommandBlocks(caret);
        if (blocks.includes(el)) {
          materializeRootInlineBlocks();
          blocks = selectedCommandBlocks(selectionRange() ?? caret);
        }
        return blocks.length > 1
          ? applyAuthoringCommandToBlocks(kind, blocks)
          : false;
      }
      if (slashRange && !caret.collapsed) return false;
      if (
        (block === el && rootHasLineBreak(el)) ||
        (block !== el && blockHasLineBreak(block))
      ) {
        block =
          block === el
            ? promoteRootLines(caret, kind)
            : promoteBlockLines(block, caret);
        const promoted = selectionRange();
        if (promoted && !promoted.collapsed) {
          const blocks = selectedCommandBlocks(promoted);
          return blocks.length > 1
            ? applyAuthoringCommandToBlocks(kind, blocks)
            : applyAuthoringCommandAtBlock(
                kind,
                blocks[0] ?? commandBlock(promoted.startContainer),
                promoted,
              );
        }
      }
      return applyAuthoringCommandAtBlock(
        kind,
        block,
        selectionRange() ?? caret,
      );
    });
  }

  function visibleOffset(raw: string, offset: number) {
    let visible = 0;
    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index] === ZERO_WIDTH_SPACE) continue;
      if (visible === offset) return index;
      visible += 1;
    }
    return raw.length;
  }

  function collapseAfterInlineFormat(
    block: HTMLElement,
    offset: number,
    format: InlineTextFormat,
  ) {
    const point = textPoint(block, offset);
    const [node, position] = point;
    if (node instanceof Text && position === node.length) {
      for (
        let current = node.parentElement;
        current && current !== block;
        current = current.parentElement
      ) {
        const ownsFormat =
          (format === "code" && current.tagName === "CODE") ||
          (format === "bold" && !!(current as HTMLElement).style.fontWeight) ||
          (format === "italic" && !!(current as HTMLElement).style.fontStyle) ||
          (format === "strike" &&
            /line-through/.test(
              `${(current as HTMLElement).style.textDecoration} ${(current as HTMLElement).style.textDecorationLine}`,
            ));
        if (ownsFormat && current.parentNode) {
          placeCaret(
            current.parentNode,
            Array.from(current.parentNode.childNodes).indexOf(current) + 1,
          );
          return;
        }
      }
    }
    placeCaret(node, position);
  }

  function applyMarkdownShortcut() {
    const caret = selectionRange();
    if (!caret?.collapsed) return;
    const block = commandBlock(caret.startContainer);
    const prefix = linePrefix(block, caret);
    const raw = prefix.toString();
    const typed = raw
      .replaceAll(ZERO_WIDTH_SPACE, "")
      .replaceAll("\u00a0", " ");
    const url = /(?:^|\s)(https?:\/\/[^\s<>]+)\s$/
      .exec(typed)?.[1]
      ?.replace(/[.,!?;:)\]}]+$/, "");
    const caretParent =
      caret.startContainer instanceof Element
        ? caret.startContainer
        : caret.startContainer.parentElement;
    if (url && URL.canParse(url) && !caretParent?.closest("a")) {
      const currentSelection = selectionOffsets(true);
      command(() => {
        const base = textOffset(
          block,
          prefix.startContainer,
          prefix.startOffset,
        );
        const start = typed.lastIndexOf(url);
        const range = document.createRange();
        range.setStart(...textPoint(block, base + visibleOffset(raw, start)));
        range.setEnd(
          ...textPoint(block, base + visibleOffset(raw, start + url.length)),
        );
        const selection = window.getSelection();
        if (!selection) return false;
        selection.removeAllRanges();
        selection.addRange(range);
        const linked = setInlineTextLink(el, url).scope === "selection";
        if (linked) selectOffsets(currentSelection, true);
        return linked;
      });
      return;
    }
    const bullet = /^[-*+] $/.test(typed);
    const ordered = /^(\d+)\. $/.exec(typed);
    const heading = /^(#{1,4}) $/.exec(typed);
    const quote = typed === "> ";
    const divider = /^(?:--- ?|___ |\*\*\* )$/.test(typed);
    const boldCandidate = /(?<!\S)(\*\*|__)([^*_\n]+)\1$/.exec(typed);
    const bold =
      boldCandidate?.[1] === "__" &&
      !/(?<![\p{L}\p{N}_])__[^_\n]+__(?![\p{L}\p{N}_])$/u.test(typed)
        ? null
        : boldCandidate;
    const italicStar = bold
      ? null
      : /(?<![\p{L}\p{N}_*])\*([^*\n]+)\*(?![\p{L}\p{N}_*])$/u.exec(typed);
    const italicUnderscore = bold
      ? null
      : /(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\p{L}\p{N}_])$/u.exec(
          typed,
        );
    const strike = /~~([^~\n]+)~~$/.exec(typed);
    const code = /`([^`\n]+)`$/.exec(typed);
    const kind = ordered
      ? "orderedList"
      : divider
        ? "divider"
        : heading
          ? (`heading${heading[1].length}` as InPlaceTextAuthoringCommand)
          : quote
            ? "quote"
            : null;

    if (bullet) {
      command(() => {
        let target = commandBlock(caret.startContainer);
        let current = selectionRange();
        if (!current) return false;
        if (hasLineBreakBefore(target, current)) {
          target =
            target === el
              ? promoteRootLines(current)
              : promoteBlockLines(target, current);
          current = selectionRange();
          if (!current) return false;
        }
        if (isBulletRow(target)) {
          deleteRange(linePrefix(target, current));
          return true;
        }
        const item = listItemAt(target);
        const parentList = item?.parentElement;
        if (item && parentList && ["OL", "UL"].includes(parentList.tagName)) {
          deleteRange(linePrefix(target, current));
          return changeListItemKind(item, "bullet");
        }
        const look = blockTextLook(target);
        const margins = blockMargins(target);
        if (target === el && (target.tagName === "P" || look)) {
          retagRoot("DIV");
          target = el;
        } else if (target !== el && (target.tagName === "P" || look)) {
          target = retag(target, "DIV");
        }
        applyBlockMargins(target, margins);
        keepTextLook(target, look);
        return convertMarkdownPrefixToBullet(target);
      });
      return;
    }

    if (kind) {
      command(() => {
        deleteRange(prefix);
        let current = selectionRange();
        if (!current) return false;
        let target = commandBlock(current.startContainer);
        if (hasLineBreakBefore(target, current)) {
          target =
            target === el
              ? promoteRootLines(current)
              : promoteBlockLines(target, current);
          current = selectionRange() ?? current;
        }
        if (ordered) {
          const item = listItemAt(current.startContainer);
          if (item)
            return changeListItemKind(item, "ordered", Number(ordered[1]));
        }
        const applied = applyAuthoringCommandAtBlock(
          kind,
          target,
          selectionRange() ?? current,
        );
        if (applied && ordered) {
          const item = listItemAt(
            selectionRange()?.startContainer ?? current.startContainer,
          );
          const list =
            item?.parentElement ??
            (el.tagName === "OL"
              ? el
              : (Array.from(el.children).find(
                  (child) => child.tagName === "OL",
                ) as HTMLElement | undefined));
          if (list) {
            if (Number(ordered[1]) === 1) list.removeAttribute("start");
            else list.setAttribute("start", ordered[1]);
          }
        }
        return applied;
      });
      return;
    }

    const inline = bold
      ? {
          match: bold,
          delimiter: bold[1],
          text: bold[2],
          format: "bold" as const,
        }
      : italicStar
        ? {
            match: italicStar,
            delimiter: "*",
            text: italicStar[1],
            format: "italic" as const,
          }
        : italicUnderscore
          ? {
              match: italicUnderscore,
              delimiter: "_",
              text: italicUnderscore[1],
              format: "italic" as const,
            }
          : strike
            ? {
                match: strike,
                delimiter: "~~",
                text: strike[1],
                format: "strike" as const,
              }
            : code
              ? {
                  match: code,
                  delimiter: "`",
                  text: code[1],
                  format: "code" as const,
                }
              : null;

    if (inline) {
      command(() => {
        const base = textOffset(
          block,
          prefix.startContainer,
          prefix.startOffset,
        );
        const openStart = visibleOffset(raw, inline.match.index);
        const textStart = visibleOffset(
          raw,
          inline.match.index + inline.delimiter.length,
        );
        const closeStart = visibleOffset(
          raw,
          inline.match.index + inline.match[0].length - inline.delimiter.length,
        );
        const contentEnd = visibleOffset(
          raw,
          inline.match.index + inline.match[0].length,
        );
        const close = document.createRange();
        close.setStart(...textPoint(block, base + closeStart));
        close.setEnd(...textPoint(block, base + contentEnd));
        deleteRange(close);
        const open = document.createRange();
        open.setStart(...textPoint(block, base + openStart));
        open.setEnd(...textPoint(block, base + textStart));
        deleteRange(open);
        const selection = window.getSelection();
        if (!selection) return false;
        const content = document.createRange();
        content.setStart(...textPoint(block, base + openStart));
        content.setEnd(
          ...textPoint(block, base + openStart + inline.text.length),
        );
        selection.removeAllRanges();
        selection.addRange(content);
        const applied =
          toggleInlineTextFormat(el, inline.format).scope === "selection";
        if (applied) {
          collapseAfterInlineFormat(
            block,
            base + openStart + inline.text.length,
            inline.format,
          );
        }
        return applied;
      });
    }
  }

  /** Retags the edited element, keeping the caret: a <p> or heading cannot hold a list row. */
  function retagRoot(tagName: string) {
    const range = selectionRange();
    const points = range
      ? ([
          [range.startContainer, range.startOffset],
          [range.endContainer, range.endOffset],
        ] as const)
      : null;
    const offsets = selectionOffsets();
    restoreSessionMenuAria();
    rebind(retag(el, tagName));
    const intact = points?.every(
      ([node, offset]) =>
        node instanceof Text && el.contains(node) && offset <= node.length,
    );
    if (points && intact) select(points[0], points[1], offsets.backward);
    else if (range) selectOffsets(offsets);
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
    code: () => styleCommand(() => toggleInlineTextFormat(el, "code")),
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
          const range = selectionRange();
          const rows = slideListRows(el, range);
          const selectedRows = range
            ? rows.filter((row) =>
                range.collapsed
                  ? row.contains(range.startContainer)
                  : range.intersectsNode(row),
              )
            : [];
          const selectedUnmarkedRows = range
            ? Array.from(el.children).filter(
                (child): child is HTMLElement =>
                  child instanceof HTMLElement &&
                  !isBulletRow(child) &&
                  ["DIV", "LI", "P"].includes(child.tagName) &&
                  (range.collapsed
                    ? child.contains(range.startContainer)
                    : range.intersectsNode(child)),
              )
            : [];
          if (
            kind === "bullet" &&
            rows.length > 0 &&
            selectedRows.length === 0 &&
            selectedUnmarkedRows.length > 0
          ) {
            const marker = rows[0].firstElementChild;
            if (marker && isBulletMarker(marker)) {
              for (const row of selectedUnmarkedRows) {
                const copy = marker.cloneNode(true) as HTMLElement;
                stripCopiedIdentity(copy);
                row.prepend(copy);
              }
              return true;
            }
          }
          if (selectedRows.length > 0) {
            const next = toggleSlideList(el, kind, selectedRows);
            if (!next) return false;
            if (next !== el) rebind(next);
            return true;
          }
          if (range?.collapsed) {
            const block = commandBlock(range.startContainer);
            if (block !== el) return toggleListAtBlock(block, kind);
          }
          const next = toggleSlideList(el, kind);
          if (!next) return false;
          if (next !== el) rebind(next);
          return true;
        }),
      ),
    applyAuthoringCommand,
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
    if (type === "historyUndo" || type === "historyRedo") {
      if (!event.cancelable) return;
      event.preventDefault();
      if (type === "historyUndo") undo();
      else redo();
      return;
    }
    if (!event.cancelable) {
      checkpoint(type.startsWith("delete") ? "delete" : "typing");
      return;
    }
    const range = selectionRange();
    const dropJoins = dragDeleted && type === "insertFromDrop";
    dragDeleted = false;
    if (!dropJoins) dragSource = null;
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
      // Not edit(): its reshape would move Chrome's live drop point.
      checkpoint("command");
      deleteRange(dragged);
      dragSource = selectionRange()?.startContainer ?? null;
      notify();
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
      if ([" ", "-", "*", "_", "~", "`"].includes(data)) {
        applyMarkdownShortcut();
      }
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
        if (type === "insertFromYank" && event.data) {
          command(() => {
            insertText(event.data!, range);
            return true;
          });
          return;
        }
        throw new Error(`in-place text session: ${type} has no dataTransfer`);
      }
      const at =
        (type === "insertFromDrop" ? targetRange(event) : null) ?? range;
      if (dropJoins) {
        if (insertClipboard(data, at)) {
          reshapeAtCaret();
          reshape(dragSource);
          notify();
        }
      } else {
        command(() => insertClipboard(data, at));
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
    if (
      input.inputType === "insertText" &&
      [" ", "-", "*", "_", "~", "`"].includes(input.data ?? "")
    ) {
      applyMarkdownShortcut();
    }
    // Replacing the node would cancel an IME composition, or move the live
    // Range Chrome drops a dragged selection at.
    if (input.inputType === "deleteByDrag") {
      dragSource = selectionRange()?.startContainer ?? null;
    } else if (!input.isComposing) {
      reshapeAtCaret();
    }
    notify();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const key = event.key.toLowerCase();
    const macControl =
      event.ctrlKey &&
      !event.metaKey &&
      /Mac|iPhone|iPad/.test(navigator.platform);
    if (macControl && ["a", "e", "y"].includes(key)) return;
    const modifier = event.metaKey || event.ctrlKey;
    const altGraph =
      event.ctrlKey && !event.metaKey && event.getModifierState("AltGraph");
    if (
      modifier &&
      event.altKey &&
      !altGraph &&
      /^Digit[0-4]$/.test(event.code)
    ) {
      event.preventDefault();
      commands.applyAuthoringCommand(
        event.code === "Digit0"
          ? "paragraph"
          : (`heading${event.code.slice(-1)}` as InPlaceTextAuthoringCommand),
      );
      return;
    }
    const mod = modifier && !event.altKey;
    if (mod && key === "z") {
      // historyUndo is only proven cancelable in Chromium; own the shortcut.
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === "y" && !event.shiftKey) {
      event.preventDefault();
      redo();
    } else if (mod && !event.shiftKey && key === "b") {
      event.preventDefault();
      commands.bold();
    } else if (mod && !event.shiftKey && key === "i") {
      event.preventDefault();
      commands.italic();
    } else if (mod && !event.shiftKey && key === "u") {
      event.preventDefault();
      commands.underline();
    } else if (mod && key === "e" && !event.shiftKey) {
      event.preventDefault();
      commands.code();
    } else if (mod && !event.shiftKey && key === "k") {
      event.preventDefault();
      const range = selectionRange();
      if (range && !range.collapsed)
        options.onRequestLink?.(range.cloneRange());
    } else if (mod && key === "a" && !event.shiftKey) {
      event.preventDefault();
      selectAllBlockOrEditable();
    } else if (mod && event.shiftKey && key === "s") {
      event.preventDefault();
      commands.strike();
    } else if (mod && event.shiftKey && key === "b") {
      event.preventDefault();
      commands.applyAuthoringCommand("quote");
    } else if (
      mod &&
      event.shiftKey &&
      (event.code === "Digit7" || event.code === "Digit8")
    ) {
      event.preventDefault();
      commands.toggleList(event.code === "Digit7" ? "ordered" : "bullet");
    } else if (event.key === "End" && !mod && !event.shiftKey) {
      // One character in, the caret is on the text's own line for End.
      const range = selectionRange();
      if (range && atRowTextStart(range)) placeCaret(range.startContainer, 1);
    } else if (event.key === "Tab" && !mod) {
      // Tab never moves focus out of the text being edited; Escape ends it.
      event.preventDefault();
      const range = selectionRange();
      if (!range) return;
      const items = selectedListItems(range);
      if (items.length > 0) {
        command(() =>
          keepingSelection(() =>
            event.shiftKey
              ? items.length > 1
                ? outdentSelectedListItems(items)
                : outdent(items[0])
              : items.reduce((changed, item) => indent(item) || changed, false),
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
    if (range) command(() => insertClipboard(data, range));
  }

  /**
   * The selection as the slide's own markup. Chrome's default serializer
   * writes every computed style (a white background, `display`, custom
   * properties) onto each run, and a paste or drop would keep it.
   */
  function writeSelection(data: DataTransfer, range: Range) {
    const holder = document.createElement("div");
    let copied = range.cloneContents();
    for (
      let ancestor =
        range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      ancestor && ancestor !== el;
      ancestor = ancestor.parentElement
    ) {
      if (!PASTE_INLINE_TAGS.has(ancestor.tagName)) continue;
      const wrapper = ancestor.cloneNode(false) as HTMLElement;
      stripCopiedIdentity(wrapper);
      wrapper.append(copied);
      copied = document.createDocumentFragment();
      copied.append(wrapper);
    }
    holder.append(copied);
    // The copies hold the range's text in order. Only the session's
    // placeholders are dropped, never an author's ZWSP.
    const preceding = document.createRange();
    preceding.setStart(el, 0);
    preceding.setEnd(range.startContainer, range.startOffset);
    const copies = textNodesIn(holder);
    const flags = authorFlags(copies, countZwsp(preceding.toString()));
    copies.forEach((copy, index) => {
      copy.data = keepZwsp(copy.data, flags[index]);
    });
    const keptZwsp = flags.flat();
    // Items copied across a list are that list, numbered from the first one.
    const common = range.commonAncestorContainer;
    if (
      common instanceof HTMLElement &&
      (common.tagName === "UL" || common.tagName === "OL")
    ) {
      const list = common.cloneNode(false) as HTMLElement;
      stripCopiedIdentity(list);
      if (common.tagName === "OL") {
        const items = Array.from(common.children).filter(
          (child) => child.tagName === "LI",
        );
        const index = items.findIndex((item) => range.intersectsNode(item));
        const reversed = common.hasAttribute("reversed");
        const start = Number.parseInt(common.getAttribute("start") ?? "", 10);
        // An unparsable start is no start, as the browser renders it.
        const first = Number.isNaN(start)
          ? reversed
            ? items.length
            : 1
          : start;
        const number = reversed ? first - index : first + index;
        if (number !== 1 || !Number.isNaN(start)) {
          list.setAttribute("start", String(number));
        }
      }
      list.append(...Array.from(holder.childNodes));
      holder.append(list);
    }
    const html = normalizeSlideClipboardHtml(holder.innerHTML);
    if (html !== null) {
      data.setData("text/html", html);
      data.setData(SLIDE_CLIPBOARD_TYPE, "1");
    }
    let zwsp = 0;
    data.setData(
      "text/plain",
      (window.getSelection()?.toString() ?? "").replace(ALL_ZWSP, (char) =>
        keptZwsp[zwsp++] ? char : "",
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
    if (range && atRowTextStart(range)) {
      checkpoint("typing");
      const placeholder = document.createTextNode(ZERO_WIDTH_SPACE);
      range.insertNode(placeholder);
      placeCaret(placeholder, placeholder.length);
      return;
    }
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

  function onCompositionEnd() {
    window.setTimeout(() => {
      if (!active) return;
      reshapeAtCaret();
      applyMarkdownShortcut();
      notify();
    }, 0);
  }

  const listeners: [string, (event: never) => void][] = [
    ["blur", onBlur],
    ["focus", onFocus],
    ["pointerdown", onPointerDown],
    ["pointerup", onPointerUp],
    ["beforeinput", onBeforeInput],
    ["input", onInput],
    ["keydown", onKeyDown],
    ["paste", onPaste],
    ["copy", onCopy],
    ["cut", onCopy],
    ["dragstart", onDragStart],
    ["compositionstart", onCompositionStart],
    ["compositionend", onCompositionEnd],
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
    const texts = textNodesIn(el);
    const flags = authorFlags(texts);
    texts.forEach((text, index) => {
      const author = flags[index];
      if (author.every(Boolean)) return;
      const block = nearestLineBox(text, el);
      const rest = lineRest(text, block);
      if (
        PLACEHOLDER_ONLY.test(text.data) &&
        !author.some(Boolean) &&
        !hasRenderedContent(rest) &&
        !rest.textContent?.includes(ZERO_WIDTH_SPACE) &&
        renderedBefore(text, block) !== "content"
      ) {
        text.replaceWith(document.createElement("br"));
      } else {
        text.data = keepZwsp(text.data, author);
      }
    });
  }

  /**
   * Chrome's native typing deletes collapsed whitespace next to the caret or
   * turns a space into a no-break space. An invisible edit is no edit: end()
   * restores the exact start bytes, so nothing is written.
   */
  function hasVisibleChange() {
    if (
      el.tagName === element.tagName &&
      el.innerHTML === startHtml &&
      !rootAttributesChanged()
    ) {
      return false;
    }
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
      value
        .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ")
        .replace(/\s+/g, "")
        .replaceAll(ZERO_WIDTH_SPACE, "");
    const comparableText = (value: string) =>
      value.replaceAll(ZERO_WIDTH_SPACE, "").replaceAll("\u00a0", " ");
    return (
      el.tagName !== element.tagName ||
      rootAttributesChanged() ||
      squash(live.innerHTML) !== squash(startHtml) ||
      comparableText(el.innerText) !== comparableText(startText)
    );
  }

  function cloneWithoutPlaceholders(root: HTMLElement): HTMLElement {
    const copy = root.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-slide-plain-row");
    for (const row of Array.from(
      copy.querySelectorAll("[data-slide-plain-row]"),
    )) {
      row.removeAttribute("data-slide-plain-row");
    }
    const copies = textNodesIn(copy);
    const texts = textNodesIn(el);
    const flags = new Map(
      authorFlags(texts).map((author, index) => [texts[index], author]),
    );
    textNodesIn(root).forEach((text, index) => {
      const author = flags.get(text);
      if (!author || author.every(Boolean)) return;
      const placeholder = copies[index];
      const rest = keepZwsp(text.data, author);
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
    restoreSessionMenuAria();
    active = false;
    unlisten(el);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
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
      // A join or split away from the caret needs the same reshape (see
      // reshapeAtCaret); the markup stays identical.
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
  const initialBackward = Boolean(
    initialRange &&
    !initialRange.collapsed &&
    selection?.anchorNode === initialRange.endContainer &&
    selection.anchorOffset === initialRange.endOffset,
  );
  el.setAttribute("contenteditable", "true");
  el.setAttribute("data-editing-block", "true");
  listen(el);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  for (const [ancestor] of pinnedScroll) {
    ancestor.addEventListener("scroll", unscroll);
  }
  // Firefox draws resize handles on images and tables inside an editable.
  document.execCommand?.("enableObjectResizing", false, "false");
  el.focus({ preventScroll: true });
  const hit = options.caretPoint ? caretFromPoint(options.caretPoint) : null;
  const point = hit && el.contains(hit[0]) ? hit : null;
  if (
    selection &&
    initialRange &&
    el.contains(initialRange.startContainer) &&
    el.contains(initialRange.endContainer) &&
    (!point || initialRange.comparePoint(...point) === 0)
  ) {
    select(
      [initialRange.startContainer, initialRange.startOffset],
      [initialRange.endContainer, initialRange.endOffset],
      initialBackward,
    );
  } else if (point) {
    placeCaret(...point);
    // A double-click in an object's move band has its default prevented, so
    // the browser selected no word.
    if (options.selectWord) selectWordAt(el, ...point);
  } else {
    placeCaret(...textPoint(el, Infinity));
  }
  // A click on a bullet's marker edits that row's text, not the glyph.
  const start = selectionRange();
  const row = start && bulletRowAt(start.startContainer);
  const marker = row && rowMarker(row);
  if (row && marker) {
    const text = rowTextRange(row, marker);
    if (text.comparePoint(start.startContainer, start.startOffset) < 0) {
      placeCaret(
        ...textPoint(
          row,
          textOffset(row, text.startContainer, text.startOffset),
        ),
      );
    }
  }
  // An element with nothing to lay out has no line box to hold a caret (a
  // text box placed with a click is 0px tall), and Chrome drops typing into
  // it. end() removes the placeholder again when nothing was typed.
  if (!hasRenderedContent(el) && !el.textContent?.includes(ZERO_WIDTH_SPACE)) {
    settleCaret(el, el.childNodes.length);
  }
  focusSelection = selectionOffsets(true);

  return {
    get element() {
      return el;
    },
    get isActive() {
      return active;
    },
    get changed() {
      return hasVisibleChange();
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
