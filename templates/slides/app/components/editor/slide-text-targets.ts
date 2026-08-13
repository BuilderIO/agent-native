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
    !isInlineTextElement(element)
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

/** Resolve a click inside inline markup to the containing editable text block. */
export function findSmartBlock(
  target: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let element: HTMLElement | null = target;
  while (element && root.contains(element)) {
    if (isTextLeaf(element)) {
      const list = findEnclosingList(element, root);
      if (list) return list;
      return element;
    }
    if (isSmartGroup(element)) return element;
    element = element.parentElement;
  }
  return null;
}
