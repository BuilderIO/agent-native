import { useT } from "@agent-native/core/client/i18n";
import {
  agentSelectNodeIdentity,
  findAgentSelectNode,
  registerAgentSelectable,
  useAgentSelectableSource,
  type AgentSelectable,
  type AgentSelectNodeIdentity,
} from "@agent-native/toolkit/app/agent-select";
import { useCallback, useEffect } from "react";

import { isLayoutSpacer } from "./slide-object-interactions";

const MAIN_SLIDE_SELECTOR = "[data-main-slide-canvas] [data-slide-canvas]";
const THUMBNAIL_SELECTOR = "[data-slide-thumbnail-id]";
/** Wraps the slide's own HTML, so paths match what update-slide edits. */
const CONTENT_SELECTOR = "[data-slide-content-scope]";
// Text formatting inside a block is part of that block, not its own object.
const INLINE_TAGS = new Set([
  "A",
  "B",
  "BR",
  "CODE",
  "EM",
  "I",
  "MARK",
  "S",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "U",
]);
const TITLE_LIMIT = 40;
const TEXT_LIMIT = 200;

interface SlideRef {
  id: string;
}

let slideElementIndex: Map<string, Element[]> | null = null;

/**
 * Every rendered slide's canvas and thumbnail, from one document query.
 * Hit testing asks for each slide's elements on every pointer frame, so the
 * index is shared until the next frame instead of querying per slide.
 */
function indexSlideElements(): Map<string, Element[]> {
  if (slideElementIndex) return slideElementIndex;
  const index = new Map<string, Element[]>();
  for (const canvas of document.querySelectorAll("[data-slide-canvas]")) {
    const slideId = canvas.getAttribute("data-slide-canvas");
    if (!slideId) continue;
    const element = canvas.closest(THUMBNAIL_SELECTOR) ?? canvas;
    const elements = index.get(slideId) ?? [];
    if (!elements.includes(element)) elements.push(element);
    index.set(slideId, elements);
  }
  slideElementIndex = index;
  const invalidate = () => {
    slideElementIndex = null;
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(invalidate);
  } else {
    setTimeout(invalidate, 0);
  }
  return index;
}

/** The slide's main canvas and its thumbnail, whichever are rendered. */
export function slideElements(slideId: string): Element[] {
  return indexSlideElements().get(slideId) ?? [];
}

/** The block-level slide object a pointer target belongs to, or null. */
export function slideObjectForTarget(target: Element): {
  element: HTMLElement;
  contentRoot: HTMLElement;
  slideId: string;
} | null {
  const contentRoot = target.closest<HTMLElement>(CONTENT_SELECTOR);
  const slideId = contentRoot
    ?.closest(MAIN_SLIDE_SELECTOR)
    ?.getAttribute("data-slide-canvas");
  if (!contentRoot || !slideId || target === contentRoot) return null;
  let element = target as HTMLElement;
  while (
    element.parentElement &&
    element.parentElement !== contentRoot &&
    (INLINE_TAGS.has(element.tagName) || isLayoutSpacer(element))
  ) {
    element = element.parentElement;
  }
  return { element, contentRoot, slideId };
}

export interface SlideObjectIdentity extends AgentSelectNodeIdentity {
  objectId: string | null;
}

export function slideObjectIdentity(
  element: HTMLElement,
  contentRoot: HTMLElement,
): SlideObjectIdentity {
  return {
    objectId: element.getAttribute("data-slide-object-id"),
    ...agentSelectNodeIdentity(element, contentRoot),
  };
}

/**
 * The object in a rendered copy of its slide, the main canvas first, found
 * again so a re-render of the slide HTML keeps the pick.
 */
export function findSlideObject(
  slideId: string,
  identity: SlideObjectIdentity,
): HTMLElement | null {
  const copies = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-slide-canvas="${CSS.escape(slideId)}"] ${CONTENT_SELECTOR}`,
    ),
  ).sort(
    (a, b) =>
      Number(Boolean(b.closest(MAIN_SLIDE_SELECTOR))) -
      Number(Boolean(a.closest(MAIN_SLIDE_SELECTOR))),
  );
  for (const copy of copies) {
    const found = identity.objectId
      ? copy.querySelector<HTMLElement>(
          `[data-slide-object-id="${CSS.escape(identity.objectId)}"]`,
        )
      : findAgentSelectNode(copy, identity);
    if (found) return found;
  }
  return null;
}

// innerText keeps the breaks between blocks that textContent runs together.
function renderedText(element: Element): string {
  // Not instanceof: an element inside a screen iframe has its own HTMLElement.
  const rendered = (element as Partial<HTMLElement>).innerText;
  return typeof rendered === "string" ? rendered : element.textContent;
}

function excerpt(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1)}…`
    : collapsed;
}

export function slideObjectSelectable(
  deckId: string,
  slideNumberOf: (slideId: string) => number | null,
  target: Element,
): AgentSelectable | null {
  const found = slideObjectForTarget(target);
  if (!found) return null;
  const { element, contentRoot, slideId } = found;
  const identity = slideObjectIdentity(element, contentRoot);
  const { objectId, path } = identity;
  const tag = element.tagName.toLowerCase();
  const text = excerpt(renderedText(element), TEXT_LIMIT);
  const alt = element.getAttribute("alt")?.trim();
  const slideNumber = slideNumberOf(slideId);
  return {
    kind: "element",
    id: `${slideId}/${objectId ? `object:${objectId}` : `path:${path}`}`,
    parent: { kind: "slide", id: slideId },
    title: excerpt(text || alt || tag, TITLE_LIMIT),
    getContext: () =>
      [
        `Deck id: ${deckId}`,
        `Slide id: ${slideId}`,
        slideNumber ? `Slide number: ${slideNumber}` : "",
        objectId
          ? `Element selector: [data-slide-object-id="${objectId}"]`
          : `Element path in the slide HTML: ${path}`,
        `Element tag: ${tag}`,
        text ? `Element text: ${text}` : "",
        alt ? `Image alt text: ${alt}` : "",
        "Edit only this element on this slide.",
      ]
        .filter(Boolean)
        .join("\n"),
    getElement: () => findSlideObject(slideId, identity),
  };
}

/**
 * Offer the deck's slides (canvas and thumbnail) and the objects on the main
 * slide canvas to the composer's Select mode.
 */
export function useSlidesAgentSelect(
  deckId: string | undefined,
  slides: readonly SlideRef[] | undefined,
): void {
  const t = useT();
  const slideIds = slides?.map((slide) => slide.id).join("\n") ?? "";

  useEffect(() => {
    if (!deckId || !slideIds) return;
    const ids = slideIds.split("\n");
    const unregister = ids.map((slideId, index) =>
      registerAgentSelectable({
        kind: "slide",
        id: slideId,
        title: t("agent.slideNumber", { number: index + 1 }),
        getContext: () =>
          [
            `Deck id: ${deckId}`,
            `Slide id: ${slideId}`,
            `Slide number: ${index + 1}`,
          ].join("\n"),
        getElement: () => slideElements(slideId),
      }),
    );
    return () => unregister.forEach((release) => release());
  }, [deckId, slideIds, t]);

  const slideNumberOf = useCallback(
    (slideId: string) => {
      const index = slideIds.split("\n").indexOf(slideId);
      return index === -1 ? null : index + 1;
    },
    [slideIds],
  );
  useAgentSelectableSource(
    deckId && slideIds
      ? (target) => slideObjectSelectable(deckId, slideNumberOf, target)
      : null,
  );
}
