/**
 * DOM-only helpers for the contentEditable slide text surface. The inspector
 * owns persistence; these helpers deliberately only touch the live edit DOM.
 */

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

function elementAttributesMatch(a: HTMLSpanElement, b: HTMLSpanElement) {
  if (a.attributes.length !== b.attributes.length) return false;
  return Array.from(a.attributes).every(
    (attribute) => b.getAttribute(attribute.name) === attribute.value,
  );
}

/** Removes only markup that cannot affect the resulting rich text. */
export function normalizeInlineTextSpans(editable: HTMLElement) {
  const spans = Array.from(editable.querySelectorAll("span"));
  for (const span of spans.reverse()) {
    if (!span.isConnected) continue;
    if (!span.textContent && span.children.length === 0) {
      span.remove();
      continue;
    }
    if (span.attributes.length === 0) {
      span.replaceWith(...Array.from(span.childNodes));
    }
  }

  let merged = true;
  while (merged) {
    merged = false;
    for (const span of Array.from(editable.querySelectorAll("span"))) {
      const next = span.nextSibling;
      if (
        next instanceof HTMLSpanElement &&
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

/**
 * Styles precisely the selected fragment. extractContents preserves partially
 * selected nested markup; patching the extracted descendants also overrides a
 * prior inline color or font on a nested span without touching unselected text.
 */
export function applyInlineTextStyle(
  editable: HTMLElement,
  patch: InlineTextStylePatch,
  selection: Selection | null = window.getSelection(),
): InlineTextStyleApplication {
  const range = getEditableTextRange(editable, selection);
  if (!range || stylePatchEntries(patch).length === 0)
    return { scope: "block" };

  const fragment = range.extractContents();
  const wrapper = document.createElement("span");
  wrapper.dataset.slideInlineStyle = "true";
  applyPatch(wrapper, patch);

  // A wrapper supplies inherited values to plain text. Existing nested spans
  // can carry explicit values, so give every extracted descendant the patch too.
  for (const child of Array.from(fragment.querySelectorAll<HTMLElement>("*"))) {
    applyPatch(child, patch);
  }
  wrapper.append(fragment);
  range.insertNode(wrapper);
  normalizeInlineTextSpans(editable);

  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
  return { scope: "selection", range: nextRange };
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
  const targets = range ? selectionTextElements(editable, range) : [];
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
  return { scope: range ? "selection" : "block", values, mixed };
}
