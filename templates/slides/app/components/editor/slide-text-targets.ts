import { findEnclosingList } from "./bullet-editing";
import { detectSlideListKind } from "./list-editing";

type EditingTarget = EventTarget | Element | null;

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
  const smartGroupMember =
    isSmartGroup(element) ||
    (isTextLeaf(element) &&
      element.parentElement instanceof HTMLElement &&
      isSmartGroup(element.parentElement));
  return (
    !element.classList.contains("fmd-layout-spacer") &&
    !isInlineTextElement(element) &&
    (!isRichTextLayerAncestor(element) || smartGroupMember)
  );
}

export function getSlideCanvasTraversalElements(
  canvasContent: HTMLElement,
): HTMLElement[] {
  return Array.from(
    canvasContent.querySelectorAll<HTMLElement>("[data-builder-id]"),
  ).filter((element) => {
    if (
      !shouldStampBuilderId(element) ||
      element.classList.contains("fmd-layout-spacer") ||
      isSlideCanvasShell(element)
    ) {
      return false;
    }

    let ancestor = element.parentElement;
    while (ancestor && ancestor !== canvasContent) {
      if (
        ancestor.hasAttribute("data-builder-id") &&
        !isSlideCanvasShell(ancestor)
      ) {
        return false;
      }
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

export function preventSlideLinkNavigation(
  event: Pick<Event, "target" | "preventDefault">,
) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("a[href]")?.closest(".slide-content")) {
    event.preventDefault();
  }
}

export function isSlideCanvasShortcutTarget(
  activeElement: Element | null,
  canvas: HTMLElement | null,
): boolean {
  return Boolean(
    activeElement &&
    (canvas?.contains(activeElement) ||
      activeElement === canvas?.ownerDocument.body),
  );
}

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
  return (
    !RICH_TEXT_TABLE_TAGS.has(element.tagName) && canEnterRichTextEdit(element)
  );
}

function ownsRichTextEditingLayer(element: HTMLElement): boolean {
  return canEnterRichTextEdit(element) && !isSmartGroup(element);
}

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

export function resolveSlideTextSelectionTarget(
  element: HTMLElement,
  root: HTMLElement,
): HTMLElement {
  let current: HTMLElement | null = element;
  while (current && current !== root && root.contains(current)) {
    if (
      current.hasAttribute("data-builder-id") &&
      !isSlideCanvasShell(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return element;
}

export function isTextLeaf(element: HTMLElement): boolean {
  if (!element || isInlineTextElement(element) || element.tagName === "IMG") {
    return false;
  }
  if (element.tagName === "H5" || element.tagName === "H6") return false;
  if (element.classList.contains("fmd-img-placeholder")) return false;
  if (element.classList.contains("fmd-text-box")) return true;
  if (!element.textContent?.trim()) return false;
  for (const child of Array.from(element.children)) {
    if (!isInlineTextElement(child)) return false;
  }
  return true;
}

export function isSmartGroup(element: HTMLElement): boolean {
  if (
    !element ||
    isInlineTextElement(element) ||
    element.tagName === "IMG" ||
    isSlideCanvasShell(element)
  ) {
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

function isEmptiedTextBlock(element: HTMLElement): boolean {
  return (
    !element.textContent?.trim() &&
    element.children.length > 0 &&
    Array.from(element.children).every((child) => child.tagName === "BR")
  );
}

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
    isSmartGroup(element) ||
    isEmptiedTextBlock(element)
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
      return RICH_TEXT_BLOCK_TAGS.has(childElement.tagName);
    })
  );
}

const RICH_TEXT_PRESERVED_STYLE_PROPERTIES = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "min-height",
  "text-align",
  "text-decoration",
]);

function hasUnsafeRichTextDescendant(element: HTMLElement): boolean {
  return [
    element,
    ...Array.from(element.querySelectorAll<HTMLElement>("*")),
  ].some((descendant) => {
    if (
      descendant.hasAttribute("data-slide-object-id") ||
      descendant.classList.contains("fmd-slide-group") ||
      descendant.classList.contains("fmd-text-box")
    ) {
      return true;
    }
    for (let index = 0; index < descendant.style.length; index += 1) {
      const property = descendant.style.item(index);
      if (!RICH_TEXT_PRESERVED_STYLE_PROPERTIES.has(property)) return true;
    }
    return false;
  });
}

function canEnterRichTextEdit(element: HTMLElement): boolean {
  if (!isRichTextBlock(element)) return false;
  if (
    isTextLeaf(element) ||
    isEmptiedTextBlock(element) ||
    detectSlideListKind(element)
  ) {
    return true;
  }
  return !hasUnsafeRichTextDescendant(element);
}

export function shouldTraverseSlideLayerChildren(
  element: HTMLElement,
): boolean {
  return !canEnterRichTextEdit(element) || isSmartGroup(element);
}

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

function findSlideRichTextOwner(
  target: HTMLElement,
  root: HTMLElement,
  boundary: HTMLElement | null,
): HTMLElement | null {
  if (target.closest(".fmd-text-box[data-slide-object-id]")) return null;
  const owners: HTMLElement[] = [];
  let element: HTMLElement | null = target;
  while (element && element !== root && root.contains(element)) {
    if (isSlideCanvasShell(element)) break;
    if (RICH_TEXT_TABLE_TAGS.has(element.tagName)) break;
    if (ownsRichTextEditingLayer(element)) owners.unshift(element);
    if (element === boundary) break;
    element = element.parentElement;
  }
  return owners.find((owner) => !holdsPaintedTextBox(owner, root)) ?? null;
}

function isTransparentPaint(color: string): boolean {
  return (
    !color ||
    color === "transparent" ||
    /^rgba\(.*,\s*0(?:\.0+)?\)$/.test(color.replace(/\s+/g, " "))
  );
}

function paintsOwnBox(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (!isTransparentPaint(style.backgroundColor)) return true;
  if (style.backgroundImage && style.backgroundImage !== "none") return true;
  if (style.boxShadow && style.boxShadow !== "none") return true;
  if (
    style.outlineStyle &&
    style.outlineStyle !== "none" &&
    Number.parseFloat(style.outlineWidth || "0") > 0
  ) {
    return true;
  }
  return (["Top", "Right", "Bottom", "Left"] as const).some(
    (side) =>
      style[`border${side}Style`] !== "none" &&
      Number.parseFloat(style[`border${side}Width`] || "0") > 0 &&
      !isTransparentPaint(style[`border${side}Color`]),
  );
}

const SLIDE_BACKDROP_AREA_RATIO = 0.9;

function isPaintedObject(element: HTMLElement, root: HTMLElement): boolean {
  if (isInlineTextElement(element) || !paintsOwnBox(element)) return false;
  const rootRect = root.getBoundingClientRect();
  const rootArea = rootRect.width * rootRect.height;
  const rect = element.getBoundingClientRect();
  return (
    rootArea <= 0 ||
    rect.width * rect.height < rootArea * SLIDE_BACKDROP_AREA_RATIO
  );
}

function paintedBoxAround(
  target: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  for (
    let element: HTMLElement | null = target;
    element && element !== root && root.contains(element);
    element = element.parentElement
  ) {
    if (isSlideCanvasShell(element)) return null;
    if (isPaintedObject(element, root)) return element;
  }
  return null;
}

export function holdsPaintedTextBox(
  element: HTMLElement,
  root: HTMLElement,
): boolean {
  return Array.from(element.querySelectorAll<HTMLElement>("*")).some(
    (box) =>
      box.tagName !== "LI" &&
      Boolean(box.textContent?.trim()) &&
      isPaintedObject(box, root),
  );
}

export function findSlideShapeOwner(
  target: HTMLElement | null,
  root: HTMLElement,
): HTMLElement | null {
  let element = target;
  while (element && element !== root && root.contains(element)) {
    if (
      isSlideCanvasShell(element) ||
      RICH_TEXT_TABLE_TAGS.has(element.tagName) ||
      element.tagName === "IMG" ||
      element.classList.contains("fmd-img-placeholder") ||
      element.classList.contains("fmd-layout-spacer") ||
      element.classList.contains("fmd-slide-group") ||
      element.classList.contains("fmd-text-box")
    ) {
      return null;
    }
    if (isPaintedObject(element, root)) return element;
    element = element.parentElement;
  }
  return null;
}

export function findGrabbedSlideShape(
  target: HTMLElement,
  root: HTMLElement,
  selected: HTMLElement | null,
): HTMLElement | null {
  const owner = findSlideShapeOwner(target, root);
  return owner && !(selected && selected !== owner && owner.contains(selected))
    ? owner
    : null;
}

export function findSmartBlock(
  target: HTMLElement,
  root: HTMLElement,
  options?: { includeTextBoxes?: boolean },
): HTMLElement | null {
  const includeTextBoxes = options?.includeTextBoxes ?? true;
  const boundary = paintedBoxAround(target, root);
  const richTextOwner = findSlideRichTextOwner(target, root, boundary);
  if (richTextOwner) return richTextOwner;
  const fits = (block: HTMLElement) =>
    (!boundary || boundary.contains(block)) &&
    !holdsPaintedTextBox(block, root);
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
      const block = resolveRichTextEditingBlock(list ?? element);
      return canEnterRichTextEdit(block) && fits(block) ? block : element;
    }
    if (isSmartGroup(element) && canEnterRichTextEdit(element)) {
      if (fits(element)) return element;
    } else if (isRichTextBlock(element)) {
      const block = resolveRichTextEditingBlock(element);
      return canEnterRichTextEdit(block) && fits(block) ? block : null;
    }
    if (element === boundary) return null;
    element = element.parentElement;
  }
  return null;
}
