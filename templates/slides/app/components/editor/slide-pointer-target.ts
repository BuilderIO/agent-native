import { detectSlideListKind } from "./list-editing";
import {
  findPersistedImageObject,
  isSlideObjectGroup,
  isSlideTableStructureElement,
} from "./slide-object-interactions";
import {
  findSmartBlock,
  isInlineTextElement,
  isPaintedObject,
  isSlideCanvasShell,
  isSmartGroup,
  isTextLeaf,
  isTransparentLayoutWrapper,
  resolveSlideTextSelectionTarget,
} from "./slide-text-targets";

/** Screen px outside a freeform object's border that still grabs it. */
export const SLIDE_POINTER_EDGE_SLOP = 5;

const TEXT_BOUNDS_SLOP = 1;
const TEXT_BOX_SELECTOR = ".fmd-text-box[data-slide-object-id]";

type PointerRect = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

export interface SlidePointerMeasure {
  /** One rect per rendered line of the element's own and nested text. */
  textRects(element: HTMLElement): readonly PointerRect[];
  boundingRect(element: HTMLElement): PointerRect;
}

export interface SlidePointerTargetInput {
  /** The `.slide-content` element: the resolver never looks above it. */
  root: HTMLElement;
  point: { x: number; y: number };
  /** `document.elementsFromPoint(...)`, topmost first. */
  stack?: readonly Element[];
  /** Used only when `stack` is empty; its ancestors stand in for the stack. */
  target?: EventTarget | null;
  modifiers?: {
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
  };
  /** Only consulted to decide whether a group's members are directly pickable. */
  selected?: HTMLElement | null;
  /** Members of every group are directly pickable (double-click). */
  intoGroups?: boolean;
  measure?: Partial<SlidePointerMeasure>;
}

export type SlidePointerTarget =
  | { kind: "whitespace"; cursor: "default" }
  | {
      kind: "object";
      object: HTMLElement;
      /** `text`: inside the text bounds. `body`: any other pixel of the object. */
      hit: "text" | "body";
      /** The element a caret goes into; null when the object has no single text root. */
      textRoot: HTMLElement | null;
      cursor: "text" | "move";
      /** The unselected object to outline on hover; always `object` unless it is the selection. */
      hoverOutline: HTMLElement | null;
      grab: "edit" | "move" | "none";
    };

interface ObjectHit {
  object: HTMLElement;
  hit: "text" | "body";
  textRoot: HTMLElement | null;
}

function measuredTextRects(element: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = [];
  const range = element.ownerDocument.createRange();
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 || rect.height > 0) rects.push(rect);
    }
  }
  // Slide-number digits are `::before` content, so the walk above never sees them.
  for (const token of element.querySelectorAll(
    "[data-slide-number],[data-slide-total]",
  )) {
    for (const rect of Array.from(token.getClientRects())) {
      if (rect.width > 0 || rect.height > 0) rects.push(rect);
    }
  }
  return rects;
}

function pointInTextBounds(
  rects: readonly PointerRect[],
  point: { x: number; y: number },
  /** Extends the bounds leftwards, e.g. over a list's marker gutter. */
  leftEdge = Infinity,
): boolean {
  if (rects.length === 0) return false;
  const left = Math.min(leftEdge, ...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return (
    point.x >= left - TEXT_BOUNDS_SLOP &&
    point.x <= right + TEXT_BOUNDS_SLOP &&
    point.y >= top - TEXT_BOUNDS_SLOP &&
    point.y <= bottom + TEXT_BOUNDS_SLOP
  );
}

function groupsAbove(element: HTMLElement, root: HTMLElement): HTMLElement[] {
  const groups: HTMLElement[] = [];
  for (
    let current = element.parentElement;
    current && current !== root && root.contains(current);
    current = current.parentElement
  ) {
    if (isSlideObjectGroup(current)) groups.unshift(current);
  }
  return groups;
}

function containerOf(
  element: HTMLElement,
  scope: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  for (
    let current: HTMLElement | null = element;
    current && current !== scope && root.contains(current);
    current = current.parentElement
  ) {
    if (isSlideCanvasShell(current) || isSlideObjectGroup(current)) return null;
    if (["TD", "TH", "TABLE"].includes(current.tagName)) return current;
    if (
      current.hasAttribute("data-slide-object-id") ||
      isPaintedObject(current, root)
    ) {
      return current;
    }
  }
  return null;
}

/** The text leaf (or whole bullet list) `element` belongs to, strictly inside `scope`. */
function textLeafWithin(
  element: HTMLElement,
  scope: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  const block = findSmartBlock(element, root, { includeTextBoxes: false });
  if (!block || block === scope || !scope.contains(block)) return null;
  if (
    isSmartGroup(block) &&
    !isTextLeaf(block) &&
    !detectSlideListKind(block)
  ) {
    return null;
  }
  return block;
}

/**
 * Where a caret goes for an object that holds text in one or several leaves
 * but is not itself the text root (a painted card): the first leaf in
 * document order.
 */
export function firstTextLeaf(
  container: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      !node.textContent?.trim() ||
      !parent ||
      parent.closest(".fmd-layout-spacer")
    ) {
      continue;
    }
    const leaf = textLeafWithin(parent, container, root);
    if (leaf) return leaf;
  }
  return null;
}

/**
 * The one answer to "what is under the pointer" for hover, press, click,
 * double-click, context menu and marquee start. A pure function of the DOM, the
 * point and the modifiers; the selection only matters for group drill-in.
 */
export function resolveSlidePointerTarget(
  input: SlidePointerTargetInput,
): SlidePointerTarget {
  const { root, point, modifiers = {}, selected = null } = input;
  const textRects = input.measure?.textRects ?? measuredTextRects;
  const boundingRect =
    input.measure?.boundingRect ??
    ((element: HTMLElement) => element.getBoundingClientRect());

  const leafOf = (element: HTMLElement, scope: HTMLElement) =>
    textLeafWithin(element, scope, root);

  const listGutterEdge = (leaf: HTMLElement): number | undefined => {
    const list = leaf.closest("ul, ol");
    return list instanceof HTMLElement && root.contains(list)
      ? boundingRect(list).left
      : undefined;
  };

  const hitForElement = (element: HTMLElement): ObjectHit | null => {
    if (isSlideObjectGroup(element) || element.closest(".fmd-layout-spacer")) {
      return null;
    }
    let scope = root;
    for (const group of groupsAbove(element, root)) {
      const drilled =
        input.intoGroups || (selected !== null && group.contains(selected));
      if (!drilled) return { object: group, hit: "body", textRoot: null };
      scope = group;
    }

    const box = element.closest<HTMLElement>(TEXT_BOX_SELECTOR);
    if (box && box !== scope && scope.contains(box)) {
      return {
        object: box,
        hit: pointInTextBounds(textRects(box), point) ? "text" : "body",
        textRoot: box,
      };
    }
    if (
      element.tagName === "IMG" ||
      element.classList.contains("fmd-img-placeholder")
    ) {
      return {
        object: findPersistedImageObject(element, scope) ?? element,
        hit: "body",
        textRoot: null,
      };
    }

    const leaf = leafOf(element, scope);
    if (
      leaf &&
      pointInTextBounds(
        textRects(leaf),
        point,
        // The bullet and the list's left gutter belong to the row's text.
        listGutterEdge(leaf),
      )
    ) {
      return {
        object: resolveSlideTextSelectionTarget(leaf, root),
        hit: "text",
        textRoot: leaf,
      };
    }
    const container = containerOf(element, scope, root);
    if (container) {
      // A cell is all text: a press anywhere in it edits, and it never moves.
      if (leaf === container && isSlideTableStructureElement(container)) {
        return { object: container, hit: "text", textRoot: container };
      }
      return {
        object: container,
        hit: "body",
        textRoot: leaf === container ? leaf : firstTextLeaf(container, root),
      };
    }
    if (leaf) {
      return {
        object: resolveSlideTextSelectionTarget(leaf, root),
        hit: "body",
        textRoot: leaf,
      };
    }
    return { object: element, hit: "body", textRoot: null };
  };

  const edgeSlopObject = (): HTMLElement | null => {
    let nearest: HTMLElement | null = null;
    let nearestDistance = Infinity;
    for (const candidate of Array.from(
      root.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    )) {
      if (
        isSlideObjectGroup(candidate) ||
        candidate.closest(".fmd-slide-group, .fmd-layout-spacer")
      ) {
        continue;
      }
      const rect = boundingRect(candidate);
      const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
      const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      const distance = Math.max(dx, dy);
      if (
        (dx === 0 && dy === 0) ||
        distance > SLIDE_POINTER_EDGE_SLOP ||
        distance > nearestDistance ||
        !["absolute", "fixed"].includes(
          window.getComputedStyle(candidate).position,
        )
      ) {
        continue;
      }
      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest;
  };

  const stack: Element[] = input.stack?.length ? [...input.stack] : [];
  if (stack.length === 0 && input.target instanceof Element) {
    for (
      let current: Element | null = input.target;
      current;
      current = current.parentElement
    ) {
      stack.push(current);
    }
  }

  const seen = new Set<HTMLElement>();
  let found: ObjectHit | null = null;
  for (const entry of stack) {
    const element =
      entry instanceof HTMLElement ? entry : (entry.parentElement ?? null);
    if (
      !element ||
      element === root ||
      !root.contains(element) ||
      seen.has(element) ||
      isSlideCanvasShell(element) ||
      isInlineTextElement(element) ||
      isTransparentLayoutWrapper(element, { root })
    ) {
      continue;
    }
    seen.add(element);
    found = hitForElement(element);
    if (found) break;
  }
  if (!found) {
    const nearby = edgeSlopObject();
    if (!nearby) return { kind: "whitespace", cursor: "default" };
    found = { object: nearby, hit: "body", textRoot: null };
  }

  const additive = Boolean(
    modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey,
  );
  return {
    kind: "object",
    object: found.object,
    hit: found.hit,
    textRoot: found.textRoot,
    cursor: found.hit === "text" ? "text" : "move",
    hoverOutline: found.object === selected ? null : found.object,
    grab: additive
      ? "none"
      : found.hit === "text" && !modifiers.altKey
        ? "edit"
        : "move",
  };
}

/**
 * Pins a live native selection inside the text root a press started in, keeping
 * its anchor and direction so the drag still extends from where it began.
 */
export function clampSelectionToTextRoot(
  selection: Selection,
  root: HTMLElement,
): void {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode) return;
  if (root.contains(anchorNode) && root.contains(focusNode)) return;
  const bounds = root.ownerDocument.createRange();
  bounds.selectNodeContents(root);
  const clampPoint = (node: Node, offset: number): [Node, number] => {
    if (root.contains(node)) return [node, offset];
    const point = root.ownerDocument.createRange();
    point.setStart(node, offset);
    point.collapse(true);
    return point.compareBoundaryPoints(Range.START_TO_START, bounds) < 0
      ? [bounds.startContainer, bounds.startOffset]
      : [bounds.endContainer, bounds.endOffset];
  };
  const [nextAnchor, nextAnchorOffset] = clampPoint(anchorNode, anchorOffset);
  const [nextFocus, nextFocusOffset] = clampPoint(focusNode, focusOffset);
  selection.setBaseAndExtent(
    nextAnchor,
    nextAnchorOffset,
    nextFocus,
    nextFocusOffset,
  );
}

/** Keeps a native selection range inside the text root the press started in. */
export function clampRangeToTextRoot(range: Range, root: HTMLElement): Range {
  const clamped = range.cloneRange();
  const bounds = root.ownerDocument.createRange();
  bounds.selectNodeContents(root);
  if (clamped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    clamped.setStart(bounds.startContainer, bounds.startOffset);
  }
  if (clamped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    clamped.setEnd(bounds.endContainer, bounds.endOffset);
  }
  return clamped;
}
