/**
 * DOM-only helpers for the contentEditable slide text surface. The inspector
 * owns persistence; these helpers deliberately only touch the live edit DOM.
 */

import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";

import {
  extractWithoutCopiedIdentity,
  stripCopiedIdentity,
} from "./bullet-editing";

export const INLINE_TEXT_STYLE_KEYS = [
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "letterSpacing",
  "lineHeight",
] as const;

export type InlineTextStyleKey = (typeof INLINE_TEXT_STYLE_KEYS)[number];

export type InlineTextStylePatch = Partial<Record<InlineTextStyleKey, string>>;

export type InlineTextStyleValues = Record<InlineTextStyleKey, string | null>;

export interface InlineTextStyleSnapshot {
  scope: "selection" | "block";
  values: InlineTextStyleValues;
  mixed: InlineTextStyleKey[];
}

export interface InlineTextStyleApplication {
  scope: "selection" | "block";
  range?: Range;
}

export type InlineTextFormat = "bold" | "italic" | "underline" | "strike";

const CSS_PROPERTY_NAMES: Record<InlineTextStyleKey, string> = {
  color: "color",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  fontStyle: "font-style",
  textDecoration: "text-decoration",
  letterSpacing: "letter-spacing",
  lineHeight: "line-height",
};

const INLINE_STYLE_SPAN = "span[data-slide-inline-style]";

const DECORATION_LINE: Record<"underline" | "strike", string> = {
  underline: "underline",
  strike: "line-through",
};

function hasRangeInside(editable: HTMLElement, range: Range) {
  return (
    editable.contains(range.startContainer) &&
    editable.contains(range.endContainer) &&
    editable.contains(range.commonAncestorContainer)
  );
}

function stylePatchEntries(patch: InlineTextStylePatch) {
  return INLINE_TEXT_STYLE_KEYS.flatMap((key) => {
    const value = patch[key]?.trim();
    return value ? [[key, value] as const] : [];
  });
}

function applyPatch(element: HTMLElement, patch: InlineTextStylePatch) {
  for (const [key, value] of stylePatchEntries(patch)) {
    element.style.setProperty(CSS_PROPERTY_NAMES[key], value);
  }
}

function elementAttributesMatch(a: Element, b: Element) {
  if (a.attributes.length !== b.attributes.length) return false;
  return Array.from(a.attributes).every(
    (attribute) => b.getAttribute(attribute.name) === attribute.value,
  );
}

/**
 * Removes only markup this module creates. Author spans are never removed or
 * merged, even when empty or identical: an empty span is often a decorative
 * dot, and merging author runs rewrites what the stored slide says.
 */
export function normalizeInlineTextSpans(editable: HTMLElement) {
  const spans = Array.from(
    editable.querySelectorAll<HTMLSpanElement>(INLINE_STYLE_SPAN),
  );
  for (const span of spans.reverse()) {
    if (!span.isConnected) continue;
    if (!span.textContent && span.children.length === 0) {
      span.remove();
      continue;
    }
    if (span.attributes.length === 1) {
      span.replaceWith(...Array.from(span.childNodes));
    }
  }

  let merged = true;
  while (merged) {
    merged = false;
    for (const span of Array.from(
      editable.querySelectorAll<HTMLSpanElement>(INLINE_STYLE_SPAN),
    )) {
      const next = span.nextSibling;
      if (
        next instanceof HTMLSpanElement &&
        next.matches(INLINE_STYLE_SPAN) &&
        elementAttributesMatch(span, next)
      ) {
        span.append(...Array.from(next.childNodes));
        next.remove();
        merged = true;
      }
    }
  }
}

/**
 * Returns a non-empty native selection only when both of its endpoints belong
 * to this editable. A range in another slide must never receive inspector CSS.
 */
export function getEditableTextRange(
  editable: HTMLElement,
  selection: Selection | null = window.getSelection(),
) {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return hasRangeInside(editable, range) ? range : null;
}

/** Clones the live selection before an inspector control takes focus. */
export function snapshotEditableTextRange(
  editable: HTMLElement,
  selection: Selection | null = window.getSelection(),
) {
  return getEditableTextRange(editable, selection)?.cloneRange() ?? null;
}

/** Selects the complete contents of one live slide text block. */
export function selectAllEditableText(
  editable: HTMLElement,
  selection: Selection | null = window.getSelection(),
) {
  if (!selection) return false;
  editable.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(editable);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Restores a captured range only while it is still safe to use in this block. */
export function restoreEditableTextRange(
  editable: HTMLElement,
  range: Range | null,
  selection: Selection | null = window.getSelection(),
) {
  if (!range || !selection || !hasRangeInside(editable, range)) return false;
  editable.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Text that is page structure rather than a run a span can style. */
function isStylableText(text: Text) {
  // ponytail: whitespace-only text holding a newline is treated as source
  // indentation; styling a deliberately blank line would need layout reads.
  if (/^\s*\n\s*$/.test(text.data)) return false;
  return !text.parentElement?.closest("style, script, template, svg");
}

/**
 * Splits text nodes at the range ends and returns each selected text run.
 * Only text nodes are split, so no author element is ever cut in two.
 */
function splitSelectedText(editable: HTMLElement, range: Range): Text[] {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  const intersecting: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) intersecting.push(node as Text);
  }
  return intersecting.flatMap((text) => {
    const from = text === startContainer ? startOffset : 0;
    const to = text === endContainer ? endOffset : text.length;
    if (from >= to || !isStylableText(text)) return [];
    let selected = text;
    if (to < selected.length) selected.splitText(to);
    if (from > 0) selected = selected.splitText(from);
    return [selected];
  });
}

/** The run's own style span: reused when it wraps exactly this run. */
function innermostStyleSpan(text: Text): HTMLSpanElement {
  const parent = text.parentElement;
  if (
    parent instanceof HTMLSpanElement &&
    parent.matches(INLINE_STYLE_SPAN) &&
    parent.childNodes.length === 1
  ) {
    return parent;
  }
  const span = document.createElement("span");
  span.dataset.slideInlineStyle = "true";
  text.replaceWith(span);
  span.append(text);
  return span;
}

function styleSelectedText(
  editable: HTMLElement,
  selection: Selection | null,
  style: (texts: Text[]) => void,
): InlineTextStyleApplication {
  const range = getEditableTextRange(editable, selection);
  if (!range) return { scope: "block" };
  const texts = splitSelectedText(editable, range);
  if (texts.length === 0) return { scope: "selection", range };
  style(texts);
  normalizeInlineTextSpans(editable);

  // Anchor on the text nodes: normalization moves them but never replaces them.
  const last = texts[texts.length - 1];
  const nextRange = document.createRange();
  nextRange.setStart(texts[0], 0);
  nextRange.setEnd(last, last.length);
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
  return { scope: "selection", range: nextRange };
}

/**
 * Styles precisely the selected text. Each selected run gets its own innermost
 * `span[data-slide-inline-style]`, so the patch beats any nested author style
 * while no author element is split, merged, or removed.
 */
export function applyInlineTextStyle(
  editable: HTMLElement,
  patch: InlineTextStylePatch,
  selection: Selection | null = window.getSelection(),
): InlineTextStyleApplication {
  if (stylePatchEntries(patch).length === 0) return { scope: "block" };
  return styleSelectedText(editable, selection, (texts) => {
    for (const text of texts) applyPatch(innermostStyleSpan(text), patch);
  });
}

function decorationLines(value: string) {
  return value.split(/\s+/).filter((line) => line && line !== "none");
}

function ownDecorationLines(element: Element) {
  const computed = window.getComputedStyle(element);
  return decorationLines(
    computed.getPropertyValue("text-decoration-line") ||
      computed.getPropertyValue("text-decoration"),
  );
}

/**
 * Decorations are not inherited: a run is underlined when any ancestor up to
 * the editable draws the line, whatever the run's own computed value says.
 */
function isFormatActive(
  text: Text,
  format: InlineTextFormat,
  editable: HTMLElement,
) {
  const element = text.parentElement;
  if (!element) return false;
  if (format === "bold") {
    const weight = window.getComputedStyle(element).fontWeight;
    return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  }
  if (format === "italic") {
    return /italic|oblique/.test(window.getComputedStyle(element).fontStyle);
  }
  for (
    let current: Element | null = element;
    current && editable.contains(current);
    current = current.parentElement
  ) {
    if (ownDecorationLines(current).includes(DECORATION_LINE[format])) {
      return true;
    }
  }
  return false;
}

function setOwnDecorationLine(element: HTMLElement, line: string, on: boolean) {
  const lines = new Set(ownDecorationLines(element));
  if (on) lines.add(line);
  else lines.delete(line);
  element.style.setProperty(
    "text-decoration-line",
    lines.size ? [...lines].join(" ") : "none",
  );
}

function containsOnlySelectedText(element: HTMLElement, selected: Set<Node>) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!selected.has(text) && text.data && isStylableText(text)) return false;
  }
  return true;
}

const FORMAT_DECLARATION = {
  bold: ["font-weight", "700", "400"],
  italic: ["font-style", "italic", "normal"],
} as const;

/**
 * Toggles a format from the selection's effective computed value. The run's
 * own declaration is dropped first and the explicit value (700/400,
 * italic/normal) is written only when what it inherits differs, so bold on
 * then off leaves no markup, while un-bolding a heading made bold by its class
 * still works without touching the class. A line drawn by an author ancestor
 * can only be switched off on that ancestor when all of its text is selected;
 * a partly selected ancestor would have to be split.
 */
export function toggleInlineTextFormat(
  editable: HTMLElement,
  format: InlineTextFormat,
  selection: Selection | null = window.getSelection(),
): InlineTextStyleApplication {
  return styleSelectedText(editable, selection, (texts) => {
    const on = !texts.every((text) => isFormatActive(text, format, editable));
    const selected = new Set<Node>(texts);
    for (const text of texts) {
      const span = innermostStyleSpan(text);
      if (format === "bold" || format === "italic") {
        const [property, onValue, offValue] = FORMAT_DECLARATION[format];
        span.style.removeProperty(property);
        if (isFormatActive(text, format, editable) !== on) {
          span.style.setProperty(property, on ? onValue : offValue);
        }
        if (span.style.length === 0) span.removeAttribute("style");
        continue;
      }
      const line = DECORATION_LINE[format];
      setOwnDecorationLine(span, line, on);
      if (on) continue;
      for (
        let ancestor = span.parentElement;
        ancestor && editable.contains(ancestor);
        ancestor = ancestor.parentElement
      ) {
        if (
          ownDecorationLines(ancestor).includes(line) &&
          containsOnlySelectedText(ancestor, selected)
        ) {
          setOwnDecorationLine(ancestor, line, false);
        }
      }
    }
  });
}

/** Moves the part of `link` on one side of `text` into its own copy of the link. */
function splitLinkPart(
  link: HTMLElement,
  text: Text,
  side: "before" | "after",
) {
  const part = document.createRange();
  if (side === "before") {
    part.setStart(link, 0);
    part.setEndBefore(text);
  } else {
    part.setStartAfter(text);
    part.setEnd(link, link.childNodes.length);
  }
  if (!part.toString()) return;
  const copy = link.cloneNode(false) as HTMLElement;
  stripCopiedIdentity(copy);
  copy.append(extractWithoutCopiedIdentity(part));
  link[side](copy);
}

/**
 * Links, or unlinks, precisely the selected text. Each selected run is
 * wrapped in its own `<a>`. A run inside a link is split out of it first, so
 * linking keeps that link's attributes (a link inside a link is split apart
 * when the slide is parsed again) and unlinking leaves the unselected rest of
 * the link linked.
 */
export function setInlineTextLink(
  editable: HTMLElement,
  href: string | null,
  selection: Selection | null = window.getSelection(),
): InlineTextStyleApplication {
  return styleSelectedText(editable, selection, (texts) => {
    for (const text of texts) {
      const link = text.parentElement?.closest("a");
      if (link && editable.contains(link)) {
        splitLinkPart(link, text, "before");
        splitLinkPart(link, text, "after");
        if (href === null) link.replaceWith(...Array.from(link.childNodes));
        else link.setAttribute("href", href);
        continue;
      }
      if (href === null) continue;
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      text.replaceWith(anchor);
      anchor.append(text);
    }
  });
}

function selectionTextElements(editable: HTMLElement, range: Range) {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  const elements = new Set<HTMLElement>();
  let node = walker.nextNode();
  while (node) {
    if (node.textContent && range.intersectsNode(node)) {
      const parent = node.parentElement;
      if (parent) elements.add(parent);
    }
    node = walker.nextNode();
  }
  return Array.from(elements);
}

function computedStyleValues(element: HTMLElement): InlineTextStyleValues {
  const computed = window.getComputedStyle(element);
  return Object.fromEntries(
    INLINE_TEXT_STYLE_KEYS.map((key) => [
      key,
      computed.getPropertyValue(CSS_PROPERTY_NAMES[key]) || null,
    ]),
  ) as InlineTextStyleValues;
}

/**
 * Reads the active selection's effective styles, returning null plus the key in
 * `mixed` when multiple selected text runs disagree. A collapsed/cross-block
 * selection intentionally reports the editable's block-level text style.
 */
export function getInlineTextStyleSnapshot(
  editable: HTMLElement,
  selection: Selection | null = window.getSelection(),
): InlineTextStyleSnapshot {
  const range = getEditableTextRange(editable, selection);
  return getInlineTextStyleSnapshotForRange(editable, range);
}

export function getInlineTextStyleSnapshotForRange(
  editable: HTMLElement,
  range: Range | null,
): InlineTextStyleSnapshot {
  const safeRange =
    range && !range.collapsed && hasRangeInside(editable, range) ? range : null;
  const targets = safeRange ? selectionTextElements(editable, safeRange) : [];
  const styles = (targets.length > 0 ? targets : [editable]).map(
    computedStyleValues,
  );
  const values = {} as InlineTextStyleValues;
  const mixed: InlineTextStyleKey[] = [];

  for (const key of INLINE_TEXT_STYLE_KEYS) {
    const first = styles[0]?.[key] ?? null;
    if (styles.some((style) => style[key] !== first)) {
      values[key] = null;
      mixed.push(key);
    } else {
      values[key] = first;
    }
  }
  return { scope: safeRange ? "selection" : "block", values, mixed };
}

const SLIDE_CLIPBOARD_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
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

const SLIDE_CLIPBOARD_LAYOUT_STYLE_PROPERTIES = [
  "position",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "box-sizing",
  "visibility",
  "pointer-events",
  "user-select",
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "z-index",
  "transform",
  "transform-origin",
] as const;

function hasSlideClipboardText(element: Element): boolean {
  return (
    Boolean(element.textContent?.trim()) ||
    element.querySelector("img") !== null
  );
}

function isSlideClipboardBlock(element: Element): boolean {
  return SLIDE_CLIPBOARD_BLOCK_TAGS.has(element.tagName);
}

/** Keep selected rich text, but discard editor context and source geometry. */
export function normalizeSlideClipboardHtml(html: string): string | null {
  if (!html || typeof DOMParser === "undefined") return null;
  const sanitized = sanitizeSlideHtml(html);
  if (!sanitized.trim()) return null;

  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  doc
    .querySelectorAll(
      "style, .fmd-layout-spacer, [data-slide-layout-spacer-for]",
    )
    .forEach((element) => element.remove());
  doc.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (!image.getAttribute("src")?.trim().toLowerCase().startsWith("data:")) {
      return;
    }
    const alt = image.getAttribute("alt");
    if (alt) image.replaceWith(doc.createTextNode(alt));
    else image.remove();
  });
  doc.querySelectorAll<HTMLElement>("*").forEach((element) => {
    if (
      element.style.visibility === "hidden" ||
      (element.style.pointerEvents === "none" &&
        element.style.userSelect === "none")
    ) {
      element.remove();
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("data-"))
        element.removeAttribute(attribute.name);
    }
    for (const property of SLIDE_CLIPBOARD_LAYOUT_STYLE_PROPERTIES) {
      element.style.removeProperty(property);
    }
  });

  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      node.remove();
    }
  }

  const wrapper = doc.body.firstElementChild;
  if (
    doc.body.children.length === 1 &&
    wrapper?.tagName === "DIV" &&
    !wrapper.attributes.length
  ) {
    while (wrapper.firstChild) doc.body.append(wrapper.firstChild);
    wrapper.remove();
  }

  const children = Array.from(doc.body.children);
  if (!children.some(isSlideClipboardBlock)) {
    const paragraph = doc.createElement("p");
    while (doc.body.firstChild) paragraph.append(doc.body.firstChild);
    doc.body.append(paragraph);
  }

  const content = Array.from(doc.body.children);
  const firstTextIndex = content.findIndex(hasSlideClipboardText);
  if (firstTextIndex < 0) return null;
  let lastTextIndex = -1;
  content.forEach((element, index) => {
    if (hasSlideClipboardText(element)) lastTextIndex = index;
  });
  content.slice(0, firstTextIndex).forEach((element) => element.remove());
  content.slice(firstTextIndex + 1, lastTextIndex + 1).forEach((element) => {
    if (element.tagName === "P" && !hasSlideClipboardText(element)) {
      element.innerHTML = "<br>";
    }
  });
  content.slice(lastTextIndex + 1).forEach((element) => element.remove());

  return doc.body.innerHTML;
}
