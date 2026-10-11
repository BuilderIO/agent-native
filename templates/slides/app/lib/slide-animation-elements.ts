import type { AnimationType } from "@/context/DeckContext";

import { ALLOWED_TAGS, DROP_WITH_CHILDREN } from "./sanitize-slide-html";
import { SOURCE_STAMP_ATTR, stampSlideSource } from "./slide-source-map";

export interface ParsedAnimationElement {
  index: number;
  path: number[];
  preview: string;
}

export interface AnimationTarget {
  elementIndex: number;
  elementPath?: number[];
  byParagraph?: boolean;
  id?: string;
}

export interface SelectedAnimationTarget {
  elementIndex: number;
  elementPath: number[];
  preview: string;
}

/**
 * Why a reveal does not resolve in its slide's HTML.
 * - stale-path: its elementPath no longer points at an element.
 * - missing-element: a legacy elementIndex target, the slide has no .fmd-slide, or
 *   the target is one the slide sanitizer does not render (see renderedBySanitizer).
 * - duplicate-after-expansion: once "By paragraph" is expanded, a step lands on
 *   an element another reveal already hides, or on one of its ancestors or
 *   descendants.
 */
export type RevealUnresolvedReason =
  | "stale-path"
  | "missing-element"
  | "duplicate-after-expansion";

/** One element a reveal hides and shows. A plain reveal has one step. */
export interface RevealStep<T extends AnimationTarget = AnimationTarget> {
  /** The reveal whose effect plays this step: an explicit reveal's own, when it is claimed by a by-paragraph reveal. */
  animation: T;
  element: Element;
  path: number[];
  /** The step's index in its by-paragraph reveal; null for a step that is not one of its paragraphs. */
  paragraphIndex: number | null;
}

interface RevealOutcomeBase {
  animationIndex: number;
  id: string | null;
}

export type RevealOutcome<T extends AnimationTarget = AnimationTarget> =
  | (RevealOutcomeBase & {
      ok: true;
      element: Element;
      path: number[];
      steps: RevealStep<T>[];
    })
  | (RevealOutcomeBase & {
      ok: false;
      reason: RevealUnresolvedReason;
      preview: string | null;
      /** The reveal's own element path when it was found. */
      path: number[] | null;
    });

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "code",
  "em",
  "i",
  "mark",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

const SKIPPED_TAGS = new Set(["script", "style", "template"]);

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hasOwnText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent),
  );
}

function hasVisualStyle(element: Element): boolean {
  const style = element.getAttribute("style") ?? "";
  return /(?:^|;)\s*(background(?:-color)?|border|box-shadow|width|height|min-width|min-height)\s*:/i.test(
    style,
  );
}

function hasMeaningfulContent(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName.toLowerCase())) return false;
  return (
    normalizeText(element.textContent).length > 0 ||
    hasVisualStyle(element) ||
    element.matches("img,svg,video,canvas,table,.fmd-img-placeholder") ||
    !!element.querySelector("img,svg,video,canvas,table,.fmd-img-placeholder")
  );
}

function shouldKeepAsSingleElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  if (SKIPPED_TAGS.has(tagName)) return false;
  if (
    element.matches(
      "img,svg,video,canvas,table,.fmd-img-placeholder,h1,h2,h3,h4,h5,h6,p,li,blockquote,pre",
    )
  ) {
    return true;
  }

  const children = Array.from(element.children).filter(
    (child) => !SKIPPED_TAGS.has(child.tagName.toLowerCase()),
  );
  if (children.length === 0) return hasMeaningfulContent(element);
  if (hasOwnText(element)) return true;

  return children.every((child) =>
    INLINE_TAGS.has(child.tagName.toLowerCase()),
  );
}

function collectAnimationElements(
  parent: Element,
  parentPath: number[],
  elements: ParsedAnimationElement[],
) {
  getPersistedChildren(parent).forEach((child, childIndex) => {
    if (SKIPPED_TAGS.has(child.tagName.toLowerCase())) return;

    const path = [...parentPath, childIndex];
    if (shouldKeepAsSingleElement(child)) {
      if (hasMeaningfulContent(child)) {
        elements.push({
          index: elements.length,
          path,
          preview: getElementPreview(child, `Element ${elements.length + 1}`),
        });
      }
      return;
    }

    const before = elements.length;
    collectAnimationElements(child, path, elements);
    if (elements.length === before && hasMeaningfulContent(child)) {
      elements.push({
        index: elements.length,
        path,
        preview: getElementPreview(child, `Element ${elements.length + 1}`),
      });
    }
  });
}

export function animationElementKey(path: number[]): string {
  return path.join(".");
}

export function findLegacyAnimationContainer(root: Element): Element | null {
  const marked = root.querySelector(".fmd-animation-container");
  if (marked && marked.children.length >= 1) return marked;

  const children = Array.from(root.children);
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].children.length >= 2) return children[i];
  }
  return null;
}

export function getElementPreview(element: Element, fallback: string): string {
  const text = normalizeText(element.textContent);
  if (text) return text.slice(0, 50);

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel).slice(0, 50);

  const alt = element.getAttribute("alt");
  if (alt) return normalizeText(alt).slice(0, 50);

  return fallback;
}

export function getElementPath(
  root: Element,
  target: Element,
): number[] | null {
  const path: number[] = [];
  let current: Element | null = target;

  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children).indexOf(current);
    if (index === -1) return null;
    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

export function getPersistedChildren(parent: Element): Element[] {
  const children: Element[] = [];
  const append = (child: Element) => {
    if (child.classList.contains("fmd-layout-spacer")) return;
    if (child.hasAttribute("data-fmd-autofit-content")) {
      Array.from(child.children).forEach(append);
      return;
    }
    children.push(child);
  };

  Array.from(parent.children).forEach(append);
  return children;
}

export function getPersistedElementPath(
  root: Element,
  target: Element,
): number[] | null {
  if (root === target) return [];

  const findPath = (parent: Element, parentPath: number[]): number[] | null => {
    for (const [persistedIndex, child] of getPersistedChildren(
      parent,
    ).entries()) {
      const path = [...parentPath, persistedIndex];
      if (child === target) return path;
      const nestedPath = findPath(child, path);
      if (nestedPath) return nestedPath;
    }
    return null;
  };

  return findPath(root, []);
}

export function resolveElementPath(
  root: Element,
  path: number[],
): Element | null {
  let current: Element | null = root;

  for (const index of path) {
    if (!current) return null;
    const next: Element | null = getPersistedChildren(current)[index] ?? null;
    if (!next) return null;
    current = next;
  }

  return current;
}

export function parseSlideAnimationElements(
  html: string,
): ParsedAnimationElement[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return [];

  const elements: ParsedAnimationElement[] = [];
  collectAnimationElements(root, [], elements);
  return elements;
}

export function resolveSlideAnimationElement(
  root: Element,
  target: AnimationTarget,
): Element | null {
  if (Array.isArray(target.elementPath)) {
    return target.elementPath.length > 0
      ? resolveElementPath(root, target.elementPath)
      : null;
  }

  const legacyContainer = findLegacyAnimationContainer(root);
  return legacyContainer?.children.item(target.elementIndex) ?? null;
}

const PARAGRAPH_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
]);

/** A paragraph element, or a div whose text has no paragraphs or lists inside it, as a generated bullet row does. */
function isParagraphBlock(element: Element): boolean {
  if (PARAGRAPH_TAGS.has(element.tagName.toLowerCase())) return true;
  return (
    element.tagName.toLowerCase() === "div" &&
    normalizeText(element.textContent).length > 0 &&
    !element.querySelector("p, h1, h2, h3, h4, h5, h6, blockquote, li, ul, ol")
  );
}

function hasParagraphsInListItem(element: Element, item: Element): boolean {
  return Array.from(element.querySelectorAll("p")).some(
    (paragraph) => paragraph.closest("li") === item,
  );
}

function collectNestedLists(parent: Element, paragraphs: Element[]) {
  for (const child of getPersistedChildren(parent)) {
    const childTagName = child.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(childTagName)) continue;
    if (childTagName === "ul" || childTagName === "ol") {
      collectListItems(child, paragraphs);
    } else {
      collectNestedLists(child, paragraphs);
    }
  }
}

function collectListItemContent(parent: Element, paragraphs: Element[]) {
  for (const child of getPersistedChildren(parent)) {
    const childTagName = child.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(childTagName)) continue;
    if (childTagName === "p") {
      if (hasMeaningfulContent(child)) paragraphs.push(child);
    } else if (childTagName === "ul" || childTagName === "ol") {
      collectListItems(child, paragraphs);
    } else if (childTagName === "li") {
      collectListItem(child, paragraphs);
    } else if (shouldKeepAsSingleElement(child)) {
      const containingListItem = parent.closest("li");
      if (
        containingListItem &&
        hasOwnText(child) &&
        hasParagraphsInListItem(child, containingListItem)
      ) {
        paragraphs.push(child);
        collectListItemContent(child, paragraphs);
      } else {
        if (hasMeaningfulContent(child)) paragraphs.push(child);
        collectNestedLists(child, paragraphs);
      }
    } else {
      collectListItemContent(child, paragraphs);
    }
  }
}

function collectListItem(item: Element, paragraphs: Element[]) {
  const itemHasParagraphs = hasParagraphsInListItem(item, item);
  if (itemHasParagraphs && hasOwnText(item)) {
    paragraphs.push(item);
    collectListItemContent(item, paragraphs);
    return;
  }
  if (!itemHasParagraphs && hasMeaningfulContent(item)) {
    paragraphs.push(item);
    collectNestedLists(item, paragraphs);
    return;
  }
  collectListItemContent(item, paragraphs);
}

function collectListItems(list: Element, paragraphs: Element[]) {
  for (const child of getPersistedChildren(list)) {
    const childTagName = child.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(childTagName)) continue;
    if (childTagName === "li") {
      collectListItem(child, paragraphs);
    } else if (childTagName === "ul" || childTagName === "ol") {
      collectListItems(child, paragraphs);
    }
  }
}

function collectParagraphs(parent: Element, paragraphs: Element[]) {
  for (const child of getPersistedChildren(parent)) {
    const childTagName = child.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(childTagName)) continue;
    if (isParagraphBlock(child)) {
      if (hasMeaningfulContent(child)) paragraphs.push(child);
    } else if (childTagName === "li") {
      collectListItem(child, paragraphs);
    } else if (childTagName === "ul" || childTagName === "ol") {
      collectListItems(child, paragraphs);
    } else {
      collectParagraphs(child, paragraphs);
    }
  }
}

/**
 * The steps a "By paragraph" reveal on `element` plays, in document order.
 * Editor and runtime both use this list, so the count the panel shows is the
 * count playback runs. One element is returned when there is nothing to split.
 *
 * - Imported paragraphs of one text object each reveal once.
 * - A list reveals each item's own text, nested lists and wrapped paragraphs
 *   in document order. A selected paragraph in a list reveals its whole list.
 * - A plain paragraph starts the reveal at itself and runs to the end of its
 *   container. Selecting paragraph N starts at N.
 * - Any other container reveals the paragraphs inside it.
 */
export function byParagraphTargets(element: Element): Element[] {
  const textObject = element.closest(".fmd-pptx-text");
  const imported = textObject
    ? Array.from(textObject.querySelectorAll("p[data-pptx-paragraph]"))
    : [];
  if (imported.length > 1) return imported;

  const paragraphs: Element[] = [];
  const tagName = element.tagName.toLowerCase();
  if (!textObject && PARAGRAPH_TAGS.has(tagName)) {
    const containingList = element.closest("li")?.closest("ul, ol");
    if (containingList) {
      collectListItems(containingList, paragraphs);
    } else {
      const siblings: Element[] = [];
      for (const sibling of getPersistedChildren(
        element.parentElement ?? element,
      )) {
        const siblingTagName = sibling.tagName.toLowerCase();
        if (isParagraphBlock(sibling)) {
          if (hasMeaningfulContent(sibling)) siblings.push(sibling);
        } else if (siblingTagName === "ul" || siblingTagName === "ol") {
          collectListItems(sibling, siblings);
        }
      }
      const index = siblings.indexOf(element);
      paragraphs.push(...(index === -1 ? siblings : siblings.slice(index)));
    }
  } else {
    const textContainer =
      textObject ??
      (tagName === "li" ? (element.closest("ul, ol") ?? element) : element);
    collectParagraphs(textContainer, paragraphs);
  }
  return paragraphs.length > 1 ? paragraphs : [element];
}

/** Resolves each target, or null when one is missing or two land on the same element. */
export function resolveSlideAnimationTargets<T extends AnimationTarget>(
  root: Element,
  targets: readonly T[],
): Array<{ target: T; element: Element; key: string }> | null {
  const seen = new Set<string>();
  const resolved: Array<{ target: T; element: Element; key: string }> = [];
  for (const target of targets) {
    const element = resolveSlideAnimationElement(root, target);
    const path = element ? getPersistedElementPath(root, element) : null;
    if (!element || !path) return null;
    const key = animationElementKey(path);
    if (seen.has(key)) return null;
    seen.add(key);
    resolved.push({ target, element, key });
  }
  return resolved;
}

interface LocatedReveal<T extends AnimationTarget> {
  animation: T;
  animationIndex: number;
  element: Element;
  path: number[];
  targets: Array<{ element: Element; path: number[] }>;
}

function isRevealOutcome<T extends AnimationTarget>(
  value: LocatedReveal<T> | RevealOutcome<T>,
): value is RevealOutcome<T> {
  return "ok" in value;
}

// The deck renderer swaps a <div class="mermaid"> block for a placeholder before
// sanitizing (mermaid-blocks.ts), so the block and its contents never reach the DOM.
const NOT_RENDERED_SELECTOR = [
  ...DROP_WITH_CHILDREN,
  'div[class="mermaid"]',
].join(",");

/**
 * Whether the runtime renders this element. The sanitizer removes a
 * DROP_WITH_CHILDREN element with its whole subtree, and unwraps any tag outside
 * ALLOWED_TAGS. Either way the element's own data-pstep is lost, so a reveal on it
 * would never hide or show anything.
 */
function renderedBySanitizer(element: Element): boolean {
  return (
    ALLOWED_TAGS.has(element.tagName.toLowerCase()) &&
    element.closest(NOT_RENDERED_SELECTOR) === null
  );
}

/**
 * The one resolver for reveals. Every animation resolves to an outcome, in
 * list order: ok with its steps, or unresolved with a typed reason. Save,
 * Play, presenter and audience all read this, so they agree on what resolves.
 * `root` is null when the content has no .fmd-slide; every reveal is then
 * unresolved.
 *
 * An explicit reveal on one of a by-paragraph reveal's steps plays that step
 * at its place in the by-paragraph order, and the by-paragraph reveal keeps
 * its other steps. Among by-paragraph reveals, the first one plays a shared
 * step.
 */
export function resolveRevealSteps<T extends AnimationTarget>(
  root: Element | null,
  animations: readonly T[],
): RevealOutcome<T>[] {
  const unresolved = (
    animation: T,
    animationIndex: number,
    reason: RevealUnresolvedReason,
    element: Element | null = null,
    path: number[] | null = null,
  ): RevealOutcome<T> => ({
    ok: false,
    animationIndex,
    id: animation.id ?? null,
    reason,
    preview: element
      ? getElementPreview(element, `Element ${animation.elementIndex + 1}`)
      : null,
    path,
  });
  if (!root) {
    return animations.map((animation, animationIndex) =>
      unresolved(animation, animationIndex, "missing-element"),
    );
  }

  const located = animations.map(
    (animation, animationIndex): LocatedReveal<T> | RevealOutcome<T> => {
      const element = resolveSlideAnimationElement(root, animation);
      if (!element) {
        return unresolved(
          animation,
          animationIndex,
          Array.isArray(animation.elementPath)
            ? "stale-path"
            : "missing-element",
        );
      }
      const path = getPersistedElementPath(root, element);
      if (!path || !renderedBySanitizer(element)) {
        return unresolved(
          animation,
          animationIndex,
          "missing-element",
          element,
          path,
        );
      }
      const elements = animation.byParagraph
        ? byParagraphTargets(element)
        : [element];
      const targets: LocatedReveal<T>["targets"] = [];
      for (const target of elements) {
        const targetPath = getPersistedElementPath(root, target);
        if (!targetPath || !renderedBySanitizer(target)) {
          return unresolved(
            animation,
            animationIndex,
            "missing-element",
            target,
            path,
          );
        }
        targets.push({ element: target, path: targetPath });
      }
      return { animation, animationIndex, element, path, targets };
    },
  );

  const explicitIndexByElement = new Map<Element, number>();
  for (const entry of located) {
    if (isRevealOutcome(entry) || entry.animation.byParagraph) continue;
    if (!explicitIndexByElement.has(entry.element)) {
      explicitIndexByElement.set(entry.element, entry.animationIndex);
    }
  }
  // Maps an explicit reveal's index to the first by-paragraph reveal that steps through it.
  const claimedBy = new Map<number, number>();
  for (const entry of located) {
    if (isRevealOutcome(entry) || !entry.animation.byParagraph) continue;
    for (const { element } of entry.targets) {
      const explicitIndex = explicitIndexByElement.get(element);
      if (explicitIndex !== undefined && !claimedBy.has(explicitIndex)) {
        claimedBy.set(explicitIndex, entry.animationIndex);
      }
    }
  }

  // Every element an earlier reveal plays, with whether it came from expansion.
  const accepted: Array<{ element: Element; expanded: boolean }> = [];
  const collides = (element: Element, expanded: boolean) =>
    accepted.some(
      (prior) =>
        prior.element === element ||
        ((expanded || prior.expanded) &&
          (prior.element.contains(element) || element.contains(prior.element))),
    );

  const results = located.map((entry): RevealOutcome<T> => {
    if (isRevealOutcome(entry)) return entry;
    const { animation, animationIndex, element, path, targets } = entry;
    const id = animation.id ?? null;

    if (!animation.byParagraph) {
      if (explicitIndexByElement.get(element) !== animationIndex) {
        return unresolved(
          animation,
          animationIndex,
          "duplicate-after-expansion",
          element,
          path,
        );
      }
      if (claimedBy.has(animationIndex)) {
        return { ok: true, animationIndex, id, element, path, steps: [] };
      }
      if (collides(element, false)) {
        return unresolved(
          animation,
          animationIndex,
          "duplicate-after-expansion",
          element,
          path,
        );
      }
      accepted.push({ element, expanded: false });
      return {
        ok: true,
        animationIndex,
        id,
        element,
        path,
        steps: [{ animation, element, path, paragraphIndex: null }],
      };
    }

    const expanded = targets.length > 1;
    const steps: RevealStep<T>[] = [];
    const playing: Array<{ element: Element; expanded: boolean }> = [];
    let collided = false;
    for (const [paragraphIndex, target] of targets.entries()) {
      if (accepted.some((prior) => prior.element === target.element)) continue;
      if (collides(target.element, expanded)) {
        collided = true;
        continue;
      }
      const explicitIndex = explicitIndexByElement.get(target.element);
      const claimant =
        explicitIndex !== undefined &&
        claimedBy.get(explicitIndex) === animationIndex
          ? animations[explicitIndex]!
          : null;
      steps.push({
        animation: claimant ?? animation,
        element: target.element,
        path: target.path,
        paragraphIndex: claimant || !expanded ? null : paragraphIndex,
      });
      playing.push({ element: target.element, expanded });
    }
    if (collided) {
      return unresolved(
        animation,
        animationIndex,
        "duplicate-after-expansion",
        element,
        path,
      );
    }
    accepted.push(...playing);
    return { ok: true, animationIndex, id, element, path, steps };
  });

  return results.map((outcome, animationIndex) => {
    const owner = claimedBy.get(animationIndex);
    if (!outcome.ok || owner === undefined || results[owner]!.ok) {
      return outcome;
    }
    return unresolved(
      animations[animationIndex]!,
      animationIndex,
      "duplicate-after-expansion",
      outcome.element,
      outcome.path,
    );
  });
}

/** The reveal steps of every ok outcome, in playback order. */
export function revealStepsOf<T extends AnimationTarget>(
  outcomes: readonly RevealOutcome<T>[],
): RevealStep<T>[] {
  return outcomes.flatMap((outcome) => (outcome.ok ? outcome.steps : []));
}

/**
 * Each reveal as the single targets playback runs, or null when any reveal is
 * unresolved. A by-paragraph reveal with several steps becomes one target per
 * step, with its paragraph index in the id.
 */
export function expandByParagraphAnimations<T extends AnimationTarget>(
  root: Element,
  animations: readonly T[],
): T[] | null {
  const expanded: T[] = [];
  for (const outcome of resolveRevealSteps(root, animations)) {
    if (!outcome.ok) return null;
    for (const step of outcome.steps) {
      if (step.paragraphIndex === null) {
        expanded.push(step.animation);
        continue;
      }
      expanded.push({
        ...step.animation,
        id: step.animation.id
          ? `${step.animation.id}-paragraph-${step.paragraphIndex}`
          : undefined,
        elementIndex: step.paragraphIndex,
        elementPath: step.path,
        byParagraph: false,
      });
    }
  }
  return expanded;
}

const STORED_STAMP_NONCE = "stored";

function stampOrdinal(stamp: string): number | null {
  const colon = stamp.lastIndexOf(":");
  if (colon === -1) return null;
  const ordinal = Number(stamp.slice(colon + 1));
  return Number.isInteger(ordinal) && ordinal >= 0 ? ordinal : null;
}

/** Parses the stored HTML the way the runtime does, with source stamps. */
function parseStoredWithStamps(stored: string): Document {
  return new DOMParser().parseFromString(
    stampSlideSource(stored, STORED_STAMP_NONCE).html,
    "text/html",
  );
}

/**
 * The persisted path, in the stored HTML, of an element on the rendered canvas.
 * The sanitized DOM drops svg, button, input and similar elements, so its
 * child indices differ from the stored HTML that playback resolves against.
 * The stamp names the stored element the rendered one came from.
 */
export function storedPathOfRenderedElement(
  stored: string,
  rendered: Element,
): number[] | null {
  const stamp = rendered.getAttribute(SOURCE_STAMP_ATTR);
  const ordinal = stamp ? stampOrdinal(stamp) : null;
  if (ordinal === null) return null;

  const doc = parseStoredWithStamps(stored);
  const root = doc.querySelector(".fmd-slide");
  const element = doc.querySelector(
    `[${SOURCE_STAMP_ATTR}="${STORED_STAMP_NONCE}:${ordinal}"]`,
  );
  if (!root || !element || !root.contains(element)) return null;
  const path = getPersistedElementPath(root, element);
  return path && path.length > 0 ? path : null;
}

/**
 * The stamp ordinal of the stored element at `path`. A rendered copy is found
 * by the same ordinal, since its stamp ends in that ordinal.
 */
export function storedOrdinalAtPath(
  stored: string,
  path: readonly number[],
): number | null {
  const root = parseStoredWithStamps(stored).querySelector(".fmd-slide");
  const element = root ? resolveElementPath(root, [...path]) : null;
  const stamp = element?.getAttribute(SOURCE_STAMP_ATTR);
  return stamp ? stampOrdinal(stamp) : null;
}

export function getElementAnimationValue(type: AnimationType): string {
  switch (type) {
    case "appear":
      return "elem-appear 100ms ease both";
    case "fade":
      return "elem-appear 400ms ease both";
    case "slide-up":
      return "elem-slide-up 300ms cubic-bezier(0.25,0.46,0.45,0.94) both";
    case "zoom":
      return "elem-zoom 300ms cubic-bezier(0.25,0.46,0.45,0.94) both";
  }
}

export function getSlideAnimationTargetKey(
  html: string,
  target: AnimationTarget,
): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return null;

  const element = resolveSlideAnimationElement(root, target);
  if (!element) return null;

  const path = getPersistedElementPath(root, element);
  return path ? animationElementKey(path) : null;
}

export function getSlideAnimationTargetPreview(
  html: string,
  target: AnimationTarget,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return `Element ${target.elementIndex + 1}`;

  const element = resolveSlideAnimationElement(root, target);
  return element
    ? getElementPreview(element, `Element ${target.elementIndex + 1}`)
    : `Element ${target.elementIndex + 1}`;
}
