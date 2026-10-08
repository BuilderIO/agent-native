import {
  getPersistedChildren,
  getPersistedElementPath,
} from "./slide-animation-elements";

/** Where the editor finds an object a history step changed. */
export interface UndoRevealTarget {
  objectId: string | null;
  /** Persisted child-index path from the `.fmd-slide` root. */
  path: number[];
}

export type UndoDirection = "undo" | "redo";

const OBJECT_ID_ATTRIBUTE = "data-slide-object-id";
// Runtime-only or bookkeeping attributes: stamping an id on first move must not
// count as editing the object.
const IGNORED_ATTRIBUTES = new Set([OBJECT_ID_ATTRIBUTE, "data-builder-id"]);
// Edits inside these roll up to the paragraph that owns them.
const INLINE_TAGS = new Set([
  "A",
  "B",
  "BR",
  "CODE",
  "DEL",
  "EM",
  "I",
  "INS",
  "MARK",
  "S",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "U",
]);

function parseSlideRoot(html: string): Element | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(".fmd-slide");
}

function objectIdOf(element: Element): string | null {
  return element.getAttribute(OBJECT_ID_ATTRIBUTE);
}

function ownSignature(element: Element): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !IGNORED_ATTRIBUTES.has(attribute.name))
    .map((attribute) => `${attribute.name}=${attribute.value}`)
    .sort()
    .join(";");
  // Inline markup is part of the paragraph that owns it, so removing a bold
  // span changes the paragraph; block children are compared on their own.
  const content = Array.from(element.childNodes)
    .map((node) => {
      if (node.nodeType === 3) return node.textContent;
      if (!(node instanceof Element)) return "";
      return INLINE_TAGS.has(node.tagName) ? node.outerHTML : "<>";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return `${element.tagName}|${attributes}|${content}`;
}

interface SlideDiff {
  changed: Element[];
  added: Element[];
  /** `anchor`: the surviving element the removed one used to follow. */
  removed: Array<{ element: Element; anchor: Element | null }>;
}

/**
 * Pair children across the two trees: by object id first, then in order when
 * the leftover counts agree (a style edit keeps its slot), else by identical
 * markup. Whatever stays unpaired was added or removed.
 */
function pairChildren(
  before: readonly Element[],
  after: readonly Element[],
  diff: SlideDiff,
): Array<[Element, Element]> {
  const pairs: Array<[Element, Element]> = [];
  const unpairedBefore = new Set(before);
  const unpairedAfter = new Set(after);
  const pair = (oldChild: Element, newChild: Element) => {
    pairs.push([oldChild, newChild]);
    unpairedBefore.delete(oldChild);
    unpairedAfter.delete(newChild);
  };

  for (const newChild of after) {
    const id = objectIdOf(newChild);
    if (!id) continue;
    const match = before.find(
      (oldChild) => unpairedBefore.has(oldChild) && objectIdOf(oldChild) === id,
    );
    if (match) pair(match, newChild);
  }
  if (unpairedBefore.size === unpairedAfter.size) {
    const remainingBefore = [...unpairedBefore];
    [...unpairedAfter].forEach((newChild, index) =>
      pair(remainingBefore[index]!, newChild),
    );
  } else {
    for (const newChild of [...unpairedAfter]) {
      const match = [...unpairedBefore].find(
        (oldChild) => oldChild.outerHTML === newChild.outerHTML,
      );
      if (match) pair(match, newChild);
    }
  }
  for (const element of unpairedBefore) {
    const index = before.indexOf(element);
    let anchor: Element | null = null;
    let anchorIndex = -1;
    for (const [oldChild, newChild] of pairs) {
      const oldIndex = before.indexOf(oldChild);
      if (oldIndex < index && oldIndex > anchorIndex) {
        anchor = newChild;
        anchorIndex = oldIndex;
      }
    }
    diff.removed.push({ element, anchor });
  }
  diff.added.push(...unpairedAfter);
  return pairs;
}

function diffSubtree(before: Element, after: Element, diff: SlideDiff) {
  for (const [oldChild, newChild] of pairChildren(
    getPersistedChildren(before),
    getPersistedChildren(after),
    diff,
  )) {
    if (ownSignature(oldChild) !== ownSignature(newChild)) {
      diff.changed.push(newChild);
    }
    diffSubtree(oldChild, newChild, diff);
  }
}

function selectableObject(element: Element, root: Element): Element | null {
  let current: Element | null = element;
  while (current && INLINE_TAGS.has(current.tagName)) {
    current = current.parentElement;
  }
  return current && current !== root && root.contains(current) ? current : null;
}

function outermost(elements: readonly Element[]): Element[] {
  return elements.filter(
    (element) =>
      !elements.some((other) => other !== element && other.contains(element)),
  );
}

/** The surviving object an undone paste or duplicate was copied from. */
function findCloneSource(
  { element: removed, anchor }: SlideDiff["removed"][number],
  after: Element,
): Element | null {
  const text = removed.textContent?.replace(/\s+/g, " ").trim();
  const candidates = Array.from(after.querySelectorAll("*")).filter(
    (candidate) =>
      candidate.tagName === removed.tagName &&
      candidate.className === removed.className &&
      candidate.textContent?.replace(/\s+/g, " ").trim() === text,
  );
  // A copy lands after its source: take the nearest match before the spot the
  // copy occupied, else the last match.
  const before = anchor
    ? candidates.filter(
        (candidate) =>
          candidate === anchor ||
          Boolean(
            anchor.compareDocumentPosition(candidate) &
            Node.DOCUMENT_POSITION_PRECEDING,
          ),
      )
    : [];
  return before.at(-1) ?? candidates.at(-1) ?? null;
}

/** A reveal handed to the editor; `sequence` makes each one apply once. */
export interface UndoSelectionRequest {
  sequence: number;
  slideId: string;
  targets: UndoRevealTarget[] | null;
}

/** What one applied history step changed, for the open editor to reveal. */
export interface UndoReveal {
  deckId: string;
  direction: UndoDirection;
  slides: Array<{
    slideId: string;
    /** `null`: the slide changed but the step cannot be compared object-wise. */
    targets: UndoRevealTarget[] | null;
  }>;
}

interface RevealOp {
  op: string;
  slideId?: string;
  fields?: object;
}

/**
 * Compare each slide a step rewrites against its current content. Call before
 * the ops are applied. `null` when the step touches no slide HTML.
 */
export function undoRevealForOps(
  deck: { slides: ReadonlyArray<{ id: string; content: string }> } | undefined,
  deckId: string,
  ops: readonly RevealOp[],
  direction: UndoDirection,
): UndoReveal | null {
  if (!deck) return null;
  const rewrites = new Map<string, { before: string; after: string }>();
  for (const op of ops) {
    const content =
      op.fields && "content" in op.fields ? op.fields.content : undefined;
    if (op.op !== "patch-slide" || typeof content !== "string") continue;
    const slideId = op.slideId;
    const current = deck.slides.find((slide) => slide.id === slideId);
    if (!slideId || !current) continue;
    rewrites.set(slideId, {
      before: rewrites.get(slideId)?.before ?? current.content,
      after: content,
    });
  }
  if (rewrites.size === 0) return null;
  return {
    deckId,
    direction,
    slides: [...rewrites].map(([slideId, { before, after }]) => ({
      slideId,
      targets: diffUndoRevealTargets(before, after, direction),
    })),
  };
}

/**
 * The objects a history step changed, as Google Slides re-selects them after
 * Undo/Redo: edited objects stay selected, a restored or re-created object is
 * selected, and undoing a paste or duplicate selects the original. `null`
 * means one side has no HTML slide to compare, which is not the same as a step
 * that selects nothing (`[]`).
 */
export function diffUndoRevealTargets(
  before: string,
  after: string,
  direction: UndoDirection,
): UndoRevealTarget[] | null {
  const beforeRoot = parseSlideRoot(before);
  const afterRoot = parseSlideRoot(after);
  if (!beforeRoot || !afterRoot) return null;

  const diff: SlideDiff = { changed: [], added: [], removed: [] };
  diffSubtree(beforeRoot, afterRoot, diff);

  let objects = [...diff.changed, ...diff.added]
    .map((element) => selectableObject(element, afterRoot))
    .filter((element): element is Element => element !== null);
  if (objects.length === 0 && direction === "undo") {
    objects = diff.removed
      .map((removed) => findCloneSource(removed, afterRoot))
      .filter((element): element is Element => element !== null);
  }

  const targets: UndoRevealTarget[] = [];
  for (const element of outermost([...new Set(objects)])) {
    const path = getPersistedElementPath(afterRoot, element);
    if (path) targets.push({ objectId: objectIdOf(element), path });
  }
  return targets;
}
