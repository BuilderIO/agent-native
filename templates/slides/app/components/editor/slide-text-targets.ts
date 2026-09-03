import { findEnclosingList } from "./bullet-editing";

type EditingTarget = EventTarget | Element | null;

/** Inline markup changes presentation, but does not create a canvas target. */
const INLINE_TEXT_TAGS = new Set([
  "SPAN",
  "STRONG",
  "EM",
  "B",
  "I",
  "U",
  "A",
  "BR",
  "CODE",
  "SUB",
  "SUP",
  "MARK",
  "SMALL",
  "S",
  "FONT",
]);

const RICH_TEXT_BLOCK_TAGS = new Set([
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "HR",
  "LI",
  "OL",
  "P",
  "UL",
]);

export function isInlineTextElement(element: Element): boolean {
  return INLINE_TEXT_TAGS.has(element.tagName);
}

function isEditingTarget(target: EditingTarget): boolean {
  if (!(target instanceof Element)) return false;
  return (
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest('[contenteditable="true"], [data-editing-block="true"]') !==
      null
  );
}

/** Whether a keyboard/pointer event belongs to an active slide text edit. */
export function isSlideTextEditingTarget(
  target: EditingTarget,
  activeElement: Element | null = null,
  editingElement: Element | null = null,
): boolean {
  return (
    isEditingTarget(target) ||
    isEditingTarget(activeElement) ||
    isEditingTarget(editingElement)
  );
}

export function shouldStampBuilderId(element: HTMLElement): boolean {
  return (
    !element.classList.contains("fmd-layout-spacer") &&
    !isInlineTextElement(element) &&
    !isRichTextLayerAncestor(element)
  );
}

/**
 * A single-cell table satisfies `isRichTextBlock` all the way up to `<table>`,
 * but a table is a grid of independently selectable cells, not one text layer.
 * Rich-text ownership stops here so cells keep their own rows and edits.
 */
const RICH_TEXT_TABLE_TAGS = new Set([
  "CAPTION",
  "COL",
  "COLGROUP",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
]);

function ownsRichTextLayer(element: HTMLElement): boolean {
  return !RICH_TEXT_TABLE_TAGS.has(element.tagName) && isRichTextBlock(element);
}

/**
 * Rich text is a single canvas layer, so the blocks inside it are structure
 * rather than layers and must not each earn their own Layers panel row.
 */
function isRichTextLayerAncestor(element: HTMLElement): boolean {
  let ancestor = element.parentElement;
  while (ancestor) {
    if (isSlideCanvasShell(ancestor)) return false;
    if (RICH_TEXT_TABLE_TAGS.has(ancestor.tagName)) return false;
    if (ownsRichTextLayer(ancestor)) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

export function isSlideCanvasShell(element: HTMLElement): boolean {
  return (
    element.classList.contains("fmd-slide") ||
    element.classList.contains("fmd-autofit-scale") ||
    element.hasAttribute("data-fmd-autofit-content") ||
    element.hasAttribute("data-slide-canvas")
  );
}

/**
 * A text leaf is a block-level element whose children are text nodes or inline
 * elements. Inline style runs are deliberately not text leaves themselves.
 */
export function isTextLeaf(element: HTMLElement): boolean {
  if (!element || isInlineTextElement(element) || element.tagName === "IMG") {
    return false;
  }
  if (element.tagName === "H5" || element.tagName === "H6") return false;
  if (element.classList.contains("fmd-img-placeholder")) return false;
  // A user-placed text box stays editable after its content is deleted.
  if (element.classList.contains("fmd-text-box")) return true;
  if (!element.textContent?.trim()) return false;
  for (const child of Array.from(element.children)) {
    if (!isInlineTextElement(child)) return false;
  }
  return true;
}

/** A container made only of text leaves or nested text groups. */
export function isSmartGroup(element: HTMLElement): boolean {
  if (!element || isInlineTextElement(element) || element.tagName === "IMG") {
    return false;
  }
  if (element.classList.contains("fmd-img-placeholder")) return false;
  const children = Array.from(element.children);
  if (children.length < 2) return false;
  if (!element.textContent?.trim()) return false;
  for (const child of children) {
    const childElement = child as HTMLElement;
    if (childElement.tagName === "IMG") return false;
    if (childElement.classList.contains("fmd-img-placeholder")) return false;
    if (!isTextLeaf(childElement) && !isSmartGroup(childElement)) return false;
  }
  return true;
}

/** A single canvas target whose descendants are rich-text structure, not layers. */
export function isRichTextBlock(element: HTMLElement): boolean {
  if (!element || isInlineTextElement(element) || element.tagName === "IMG") {
    return false;
  }
  if (element.tagName === "H5" || element.tagName === "H6") return false;
  if (
    element.classList.contains("fmd-slide") ||
    element.classList.contains("slide-content") ||
    element.classList.contains("fmd-autofit-scale") ||
    element.hasAttribute("data-fmd-autofit-content") ||
    element.hasAttribute("data-slide-canvas")
  ) {
    return false;
  }
  if (
    element.classList.contains("fmd-text-box") ||
    element.getAttribute("data-editing-block") === "true" ||
    isTextLeaf(element) ||
    isSmartGroup(element)
  ) {
    return true;
  }
  const children = Array.from(element.children);
  return (
    children.length > 0 &&
    (Boolean(element.textContent?.trim()) ||
      children.some((child) => child.tagName === "HR")) &&
    children.every((child) => {
      const childElement = child as HTMLElement;
      return (
        RICH_TEXT_BLOCK_TAGS.has(childElement.tagName) ||
        (children.length === 1 && isRichTextBlock(childElement))
      );
    })
  );
}

/** Keep a semantic list inside its containing canvas text block while editing. */
export function resolveRichTextEditingBlock(element: HTMLElement): HTMLElement {
  let block = element;
  while (
    RICH_TEXT_BLOCK_TAGS.has(block.tagName) &&
    block.parentElement &&
    isRichTextBlock(block.parentElement)
  ) {
    block = block.parentElement;
  }
  return block;
}

/**
 * Outermost rich text block containing `target`, so a click on a paragraph
 * inside one resolves to the whole layer instead of that one paragraph.
 */
function findSlideRichTextOwner(
  target: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  if (target.closest(".fmd-text-box[data-slide-object-id]")) return null;
  let owner: HTMLElement | null = null;
  let element: HTMLElement | null = target;
  while (element && element !== root && root.contains(element)) {
    if (isSlideCanvasShell(element)) break;
    if (RICH_TEXT_TABLE_TAGS.has(element.tagName)) break;
    if (ownsRichTextLayer(element)) owner = element;
    element = element.parentElement;
  }
  return owner;
}

/** Resolve a click inside inline markup to the containing editable text block. */
export function findSmartBlock(
  target: HTMLElement,
  root: HTMLElement,
  options?: { includeTextBoxes?: boolean },
): HTMLElement | null {
  const includeTextBoxes = options?.includeTextBoxes ?? true;
  const richTextOwner = findSlideRichTextOwner(target, root);
  if (richTextOwner) return richTextOwner;
  let element: HTMLElement | null = target;
  while (element && root.contains(element)) {
    if (
      !includeTextBoxes &&
      element.closest(".fmd-text-box[data-slide-object-id]")
    ) {
      return null;
    }
    if (isTextLeaf(element)) {
      const list = findEnclosingList(element, root);
      if (list) return resolveRichTextEditingBlock(list);
      return resolveRichTextEditingBlock(element);
    }
    if (isSmartGroup(element)) return element;
    if (isRichTextBlock(element)) return resolveRichTextEditingBlock(element);
    element = element.parentElement;
  }
  return null;
}
