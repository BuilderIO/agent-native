import type { AnimationType } from "@/context/DeckContext";

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
 * - missing-element: a legacy elementIndex target, or the slide has no .fmd-slide.
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
  animation: T;
  element: Element;
  path: number[];
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
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
]);

function isParagraphBlock(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (PARAGRAPH_TAGS.has(tag)) return true;
  return tag === "div" && normalizeText(element.textContent).length > 0;
}

/**
 * The steps a "By paragraph" reveal on `element` plays, in document order.
 * Editor and runtime both use this list, so the count the panel shows is the
 * count playback runs.
 *
 * - An element with paragraph children reveals those children.
 * - A paragraph inside a container starts the reveal at itself and runs to the
 *   end of that container. Selecting paragraph N starts at N.
 * - Anything else is one step: the element itself.
 */
export function byParagraphTargets(element: Element): Element[] {
  const blocks = getPersistedChildren(element).filter(isParagraphBlock);
  if (blocks.length > 0) return blocks;

  const parent = element.parentElement;
  if (parent && PARAGRAPH_TAGS.has(element.tagName.toLowerCase())) {
    const siblings = getPersistedChildren(parent).filter(isParagraphBlock);
    const index = siblings.indexOf(element);
    if (index !== -1) return siblings.slice(index);
  }
  return [element];
}

/**
 * The one resolver for reveals. Every animation resolves to an outcome, in
 * list order: ok with its steps, or unresolved with a typed reason. Save,
 * Play, presenter and audience all read this, so they agree on what resolves.
 * `root` is null when the content has no .fmd-slide; every reveal is then
 * unresolved.
 */
export function resolveRevealSteps<T extends AnimationTarget>(
  root: Element | null,
  animations: readonly T[],
): RevealOutcome<T>[] {
  // Every element an earlier reveal hides, with whether it came from expansion.
  const accepted: Array<{ element: Element; expanded: boolean }> = [];

  return animations.map((animation, animationIndex): RevealOutcome<T> => {
    const id = animation.id ?? null;
    const fail = (
      reason: RevealUnresolvedReason,
      element: Element | null = null,
      path: number[] | null = null,
    ): RevealOutcome<T> => ({
      ok: false,
      animationIndex,
      id,
      reason,
      preview: element
        ? getElementPreview(element, `Element ${animation.elementIndex + 1}`)
        : null,
      path,
    });

    if (!root) return fail("missing-element");
    const element = resolveSlideAnimationElement(root, animation);
    if (!element) {
      return fail(
        Array.isArray(animation.elementPath) ? "stale-path" : "missing-element",
      );
    }
    const path = getPersistedElementPath(root, element);
    if (!path) return fail("missing-element", element);

    const targets = animation.byParagraph
      ? byParagraphTargets(element)
      : [element];
    const steps: RevealStep<T>[] = [];
    for (const target of targets) {
      const targetPath = getPersistedElementPath(root, target);
      if (!targetPath) return fail("missing-element", target, path);
      steps.push({ animation, element: target, path: targetPath });
    }

    // Expansion can put a step on an element a prior reveal already hides, or
    // on its ancestor or descendant. Plain reveals may nest on purpose, so
    // ancestor overlap only counts when one side came from expansion.
    const expanded = targets.some((target) => target !== element);
    const collides = steps.some(({ element: step }) =>
      accepted.some(
        (prior) =>
          prior.element === step ||
          ((expanded || prior.expanded) &&
            (prior.element.contains(step) || step.contains(prior.element))),
      ),
    );
    if (collides) return fail("duplicate-after-expansion", element, path);

    for (const step of steps)
      accepted.push({ element: step.element, expanded });
    return { ok: true, animationIndex, id, element, path, steps };
  });
}

/** The reveal steps of every ok outcome, in playback order. */
export function revealStepsOf<T extends AnimationTarget>(
  outcomes: readonly RevealOutcome<T>[],
): RevealStep<T>[] {
  return outcomes.flatMap((outcome) => (outcome.ok ? outcome.steps : []));
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
