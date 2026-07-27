import type { PlanCommentAnchor } from "@shared/comment-context";
import type { PlanBlock } from "@shared/plan-content";

import type { PlanVisualSurfaceMode } from "@/components/plan/PlanVisualSurface";

export type PlanAnnotationAnchor = PlanCommentAnchor & { x: number; y: number };

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function percent(value: number, total: number) {
  return clamp((value / Math.max(total, 1)) * 100, 0, 100);
}

const PLAN_TEXT_TARGET_SELECTOR = [
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "td",
  "th",
  "blockquote",
  "figcaption",
  "summary",
  "button",
  "a",
  "label",
  "pre",
  "code",
  "[data-plan-text]",
].join(",");

const PLAN_VISUAL_TARGET_SELECTOR = [
  "img",
  "svg",
  "canvas",
  "video",
  "iframe",
  "table",
  "pre",
  "code",
  "[data-plan-canvas-world]",
  ".plan-canvas-world",
  "[data-plan-prototype-viewer]",
  "[data-prototype-screen]",
  "[data-canvas-frame]",
  ".plan-artboard-frame",
  ".plan-block",
].join(",");

function normalizedElementText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function textSnippetFromElement(element: Element | null, max = 220) {
  if (!element) return "";
  return normalizedElementText(element.textContent).slice(0, max);
}

export function textQuoteContextForBlock(input: {
  block: Element | null;
  quote: string;
  radius?: number;
}) {
  const quote = normalizedElementText(input.quote);
  const blockText = normalizedElementText(input.block?.textContent);
  if (!quote || !blockText) return {};
  const index = blockText.indexOf(quote);
  if (index < 0) return {};
  const radius = input.radius ?? 60;
  const contextBefore = blockText.slice(Math.max(0, index - radius), index);
  const contextAfter = blockText.slice(
    index + quote.length,
    index + quote.length + radius,
  );
  const secondIndex = blockText.indexOf(quote, index + quote.length);
  return {
    contextBefore: contextBefore || undefined,
    contextAfter: contextAfter || undefined,
    ambiguous: secondIndex >= 0 || undefined,
  };
}

function textNeedleForAnchor(anchor: PlanAnnotationAnchor) {
  const source =
    anchor.textQuote ??
    (anchor.anchorKind === "text" || anchor.targetKind === "text"
      ? anchor.snippet
      : undefined);
  return normalizedElementText(source).slice(0, 120);
}

function findTextAnchorTarget(scope: Element, needle: string) {
  if (!needle) return null;
  const candidates = [
    ...(scope.matches(PLAN_TEXT_TARGET_SELECTOR) ? [scope] : []),
    ...Array.from(
      scope.querySelectorAll<HTMLElement>(PLAN_TEXT_TARGET_SELECTOR),
    ),
  ];
  return (
    candidates.find((candidate) =>
      normalizedElementText(candidate.textContent).includes(needle),
    ) ?? null
  );
}

export function findPlanBlockById(
  blocks: PlanBlock[],
  id: string,
): PlanBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type !== "tabs") continue;
    for (const tab of block.data.tabs) {
      const match = findPlanBlockById(tab.blocks, id);
      if (match) return match;
    }
  }
  return null;
}

function cssAttr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function elementIndexAmongType(element: Element) {
  const parent = element.parentElement;
  if (!parent) return 1;
  const tag = element.tagName;
  return (
    Array.from(parent.children)
      .filter((child) => child.tagName === tag)
      .indexOf(element) + 1
  );
}

function childPathSelectorWithin(scope: Element, element: Element) {
  if (scope === element) return "";
  if (!scope.contains(element)) return undefined;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== scope) {
    const parent = current.parentElement;
    if (!parent) return undefined;
    const tag = current.tagName.toLowerCase();
    parts.unshift(`${tag}:nth-of-type(${elementIndexAmongType(current)})`);
    current = parent;
  }
  return current === scope ? parts.join(" > ") : undefined;
}

function dataSelector(name: string, value: string) {
  return `[${name}="${cssAttr(value)}"]`;
}

function scopedSelector(scope: string | undefined, selector: string) {
  return scope ? `${scope} ${selector}` : selector;
}

function selectorForElementInScope(
  scopeElement: Element,
  scopeSelector: string,
  element: Element,
) {
  const path = childPathSelectorWithin(scopeElement, element);
  if (path === undefined) return undefined;
  return path ? `${scopeSelector} > ${path}` : scopeSelector;
}

function stableDataSelectorForElement(
  element: Element,
  scope?: string,
): string | undefined {
  const wireNode = element.closest<HTMLElement>("[data-wire-node-id]");
  if (wireNode?.dataset.wireNodeId) {
    return scopedSelector(
      scope,
      dataSelector("data-wire-node-id", wireNode.dataset.wireNodeId),
    );
  }
  const designNode = element.closest<HTMLElement>("[data-design-id]");
  if (designNode?.dataset.designId) {
    return scopedSelector(
      scope,
      dataSelector("data-design-id", designNode.dataset.designId),
    );
  }
  const planDesignNode = element.closest<HTMLElement>("[data-plan-design-id]");
  if (planDesignNode?.dataset.planDesignId) {
    return scopedSelector(
      scope,
      dataSelector("data-plan-design-id", planDesignNode.dataset.planDesignId),
    );
  }
  return undefined;
}

export function selectorForElementWithin(
  root: HTMLElement,
  element: Element | null,
) {
  if (!element || !root.contains(element)) return undefined;
  const prototype = element.closest<HTMLElement>("[data-prototype-screen]");
  const prototypeScope = prototype?.dataset.prototypeScreen
    ? dataSelector("data-prototype-screen", prototype.dataset.prototypeScreen)
    : undefined;
  const prototypeStableSelector = prototypeScope
    ? stableDataSelectorForElement(element, prototypeScope)
    : undefined;
  if (prototypeStableSelector) return prototypeStableSelector;
  if (prototype && prototypeScope) {
    return selectorForElementInScope(prototype, prototypeScope, element);
  }
  const frame = element.closest<HTMLElement>("[data-canvas-frame]");
  const frameScope = frame?.dataset.canvasFrame
    ? dataSelector("data-canvas-frame", frame.dataset.canvasFrame)
    : undefined;
  const frameStableSelector = frameScope
    ? stableDataSelectorForElement(element, frameScope)
    : undefined;
  if (frameStableSelector) return frameStableSelector;
  if (frame && frameScope) {
    return selectorForElementInScope(frame, frameScope, element);
  }
  const canvasWorld = element.closest<HTMLElement>(
    "[data-plan-canvas-world], .plan-canvas-world",
  );
  if (canvasWorld) {
    return canvasWorld.hasAttribute("data-plan-canvas-world")
      ? "[data-plan-canvas-world]"
      : ".plan-canvas-world";
  }
  const stableSelector = stableDataSelectorForElement(element);
  if (stableSelector) return stableSelector;
  const block = element.closest<HTMLElement>("[data-block-id]");
  if (block?.dataset.blockId) {
    return selectorForElementInScope(
      block,
      dataSelector("data-block-id", block.dataset.blockId),
      element,
    );
  }
  if (element.id) return `#${cssAttr(element.id)}`;
  return undefined;
}

function prototypeScreenIdFromSelector(selector: string | undefined) {
  if (!selector) return undefined;
  const match = selector.match(/\[data-prototype-screen="([^"]+)"\]/);
  return match?.[1]?.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function prototypeScreenIdForAnchor(anchor: PlanAnnotationAnchor) {
  return (
    anchor.screenId ??
    prototypeScreenIdFromSelector(anchor.targetSelector) ??
    (anchor.targetKind === "prototype" ? anchor.sectionId : undefined)
  );
}

function prototypeScopeForAnchor(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
) {
  const screenId = prototypeScreenIdForAnchor(anchor);
  if (!screenId) return undefined;
  return (
    reader.querySelector<HTMLElement>(
      `[data-prototype-screen="${cssAttr(screenId)}"]`,
    ) ?? null
  );
}

function queryFirstElement(
  scopes: Array<Element | null | undefined>,
  selector: string,
) {
  const seen = new Set<Element>();
  for (const scope of scopes) {
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    const target = scope.matches(selector)
      ? scope
      : scope.querySelector<HTMLElement>(selector);
    if (target) return target;
  }
  return null;
}

function resolveStableVisualAnchorTarget(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
  queryRoot: Element,
) {
  const frame = anchor.sectionId
    ? reader.querySelector<HTMLElement>(
        dataSelector("data-canvas-frame", anchor.sectionId),
      )
    : null;
  if (anchor.targetNodeId) {
    const nodeSelectors = [
      dataSelector("data-wire-node-id", anchor.targetNodeId),
      dataSelector("data-design-id", anchor.targetNodeId),
      dataSelector("data-plan-design-id", anchor.targetNodeId),
    ];
    for (const selector of nodeSelectors) {
      const target = queryFirstElement([frame, queryRoot, reader], selector);
      if (target) return target;
    }
  }
  return null;
}

function sectionTitleForElement(element: Element | null, fallback?: string) {
  const block = element?.closest<HTMLElement>("[data-block-id]");
  const prototype = element?.closest<HTMLElement>("[data-prototype-screen]");
  const frame = element?.closest<HTMLElement>("[data-canvas-frame]");
  const title =
    prototype
      ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    block
      ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    frame
      ?.querySelector<HTMLElement>(".plan-artboard-label")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    element
      ?.closest<HTMLElement>(".plan-block,.plan-canvas")
      ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    fallback;
  return title || undefined;
}

function targetKindForElement(
  element: Element | null,
): PlanCommentAnchor["targetKind"] {
  if (!element) return undefined;
  const tag = element.tagName.toLowerCase();
  if (tag === "img") return "image";
  if (tag === "table") return "table";
  if (tag === "pre" || tag === "code") return "code";
  if (tag === "svg") return "diagram";
  if (element.closest("[data-plan-prototype-viewer]")) return "prototype";
  if (element.closest("[data-canvas-frame],.plan-artboard-frame")) {
    return "wireframe";
  }
  if (tag === "canvas" || element.closest(".plan-canvas")) return "canvas";
  if (element.matches("button,a,input,textarea,select,label")) return "control";
  if (element.closest("[data-block-id]")) return "block";
  return "unknown";
}

export function buildNativeAnchorFromElement(input: {
  reader: HTMLElement;
  target: HTMLElement;
  pointX: number;
  pointY: number;
  planTitle?: string;
}): PlanAnnotationAnchor {
  const { reader, target, pointX, pointY } = input;
  const scrollWidth = Math.max(reader.scrollWidth, 1);
  const scrollHeight = Math.max(reader.scrollHeight, 1);
  const base: PlanAnnotationAnchor = {
    x: percent(pointX + reader.scrollLeft, scrollWidth),
    y: percent(pointY + reader.scrollTop, scrollHeight),
    anchorKind: "point",
    visualLabel: input.planTitle,
    resolutionTarget: "agent",
  };

  const textElement = target.closest<HTMLElement>(PLAN_TEXT_TARGET_SELECTOR);
  const visualElement = target.closest<HTMLElement>(
    PLAN_VISUAL_TARGET_SELECTOR,
  );
  const wireNodeEl = target.closest<HTMLElement>("[data-wire-node-id]");
  const designNodeEl = target.closest<HTMLElement>("[data-design-id]");
  const planDesignNodeEl = target.closest<HTMLElement>("[data-plan-design-id]");
  const stableVisualElement = wireNodeEl ?? designNodeEl ?? planDesignNodeEl;
  const anchorElement =
    stableVisualElement ??
    (textElement && textSnippetFromElement(textElement)
      ? textElement
      : (visualElement ?? target));
  const rect = anchorElement.getBoundingClientRect();
  const readerRect = reader.getBoundingClientRect();
  const localX = pointX + readerRect.left;
  const localY = pointY + readerRect.top;
  const targetX = percent(
    clamp(localX, rect.left, rect.right) - rect.left,
    rect.width,
  );
  const targetY = percent(
    clamp(localY, rect.top, rect.bottom) - rect.top,
    rect.height,
  );
  const sectionTitle = sectionTitleForElement(anchorElement, input.planTitle);
  const prototype = anchorElement.closest<HTMLElement>(
    "[data-prototype-screen]",
  );
  const block = anchorElement.closest<HTMLElement>("[data-block-id]");
  const frame = anchorElement.closest<HTMLElement>("[data-canvas-frame]");
  const targetText = textSnippetFromElement(anchorElement);
  const targetKind = targetKindForElement(anchorElement);
  const image =
    anchorElement.tagName.toLowerCase() === "img"
      ? (anchorElement as HTMLImageElement)
      : anchorElement.querySelector<HTMLImageElement>("img");
  const visualContext =
    prototype?.dataset.prototypeScreen && sectionTitle
      ? `Inside prototype screen ${prototype.dataset.prototypeScreen} (${sectionTitle})`
      : prototype?.dataset.prototypeScreen
        ? `Inside prototype screen ${prototype.dataset.prototypeScreen}`
        : frame?.dataset.canvasFrame && sectionTitle
          ? `Inside canvas frame ${frame.dataset.canvasFrame} (${sectionTitle})`
          : frame?.dataset.canvasFrame
            ? `Inside canvas frame ${frame.dataset.canvasFrame}`
            : undefined;

  const targetNodeId =
    wireNodeEl?.dataset.wireNodeId ||
    designNodeEl?.dataset.designId ||
    planDesignNodeEl?.dataset.planDesignId ||
    undefined;

  // Build a short human-readable node path from the frame root down to the
  // target node, e.g. `card > list > listItem "Acme Inc"`.
  let targetNodePath: string | undefined;
  if (wireNodeEl) {
    const frameRoot =
      anchorElement.closest<HTMLElement>("[data-canvas-frame]") ??
      anchorElement.closest<HTMLElement>(".plan-artboard-frame");
    if (frameRoot) {
      const pathEls: HTMLElement[] = [];
      let current: HTMLElement | null = wireNodeEl;
      while (current && current !== frameRoot && frameRoot.contains(current)) {
        if (current.dataset.wireNodeId) pathEls.unshift(current);
        current = current.parentElement;
      }
      if (pathEls.length === 0) pathEls.push(wireNodeEl);
      const segments = pathEls.map((el) => {
        const elName = el.dataset.wireNodeEl ?? el.tagName.toLowerCase();
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40);
        return directText ? `${elName} "${directText}"` : elName;
      });
      if (segments.length > 0) targetNodePath = segments.join(" > ");
    }
  }

  return {
    ...base,
    sectionId:
      prototype?.dataset.prototypeScreen ??
      frame?.dataset.canvasFrame ??
      block?.dataset.blockId,
    screenId: prototype?.dataset.prototypeScreen,
    sectionTitle,
    targetSelector: selectorForElementWithin(reader, anchorElement),
    targetX,
    targetY,
    tagName: anchorElement.tagName.toLowerCase(),
    anchorKind:
      textElement && targetText ? "text" : targetKind ? "visual" : "point",
    textQuote: textElement && targetText ? targetText.slice(0, 220) : undefined,
    snippet: targetText || sectionTitle,
    visualLabel: sectionTitle ?? input.planTitle,
    visualX: targetX,
    visualY: targetY,
    targetKind,
    targetLabel:
      image?.alt?.trim() ||
      anchorElement.getAttribute("aria-label") ||
      sectionTitle ||
      targetText.slice(0, 80) ||
      input.planTitle,
    targetText: targetText || undefined,
    targetAlt: image?.alt?.trim() || undefined,
    targetSrc: image?.currentSrc || image?.src || undefined,
    visualContext,
    ...(targetNodeId !== undefined ? { targetNodeId } : {}),
    ...(targetNodePath !== undefined ? { targetNodePath } : {}),
  };
}

export function resolveNativeAnchorTarget(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
) {
  const prototypeScope = prototypeScopeForAnchor(anchor, reader);
  if (prototypeScope === null) return null;
  const queryRoot = prototypeScope ?? reader;
  const needle = textNeedleForAnchor(anchor);
  const stableVisualTarget = resolveStableVisualAnchorTarget(
    anchor,
    reader,
    queryRoot,
  );
  if (stableVisualTarget) return stableVisualTarget;
  if (anchor.targetSelector) {
    try {
      const target = queryRoot.matches(anchor.targetSelector)
        ? queryRoot
        : queryRoot.querySelector<HTMLElement>(anchor.targetSelector);
      if (target) {
        if (!needle) return target;
        const textTarget = findTextAnchorTarget(target, needle);
        if (textTarget) return textTarget;
      }
    } catch {
      // Fall back to broad visual targets or quote matching below.
    }
  }
  if (
    anchor.planAnnotationId ||
    anchor.canvasX !== undefined ||
    anchor.targetKind === "canvas"
  ) {
    const canvasWorld = reader.querySelector<HTMLElement>(
      "[data-plan-canvas-world], .plan-canvas-world",
    );
    if (canvasWorld) return canvasWorld;
  }
  if (anchor.targetKind === "wireframe" && anchor.sectionId) {
    const frame = reader.querySelector<HTMLElement>(
      dataSelector("data-canvas-frame", anchor.sectionId),
    );
    if (frame) return frame;
  }
  if (!needle) return null;
  const scopes: Element[] = [];
  if (prototypeScope) {
    scopes.push(prototypeScope);
  } else if (anchor.sectionId) {
    const byBlock = reader.querySelector<HTMLElement>(
      `[data-block-id="${cssAttr(anchor.sectionId)}"]`,
    );
    const byFrame = reader.querySelector<HTMLElement>(
      `[data-canvas-frame="${cssAttr(anchor.sectionId)}"]`,
    );
    if (byBlock) scopes.push(byBlock);
    if (byFrame) scopes.push(byFrame);
  }
  if (!prototypeScope) scopes.push(reader);
  for (const scope of scopes) {
    const match = findTextAnchorTarget(scope, needle);
    if (match) return match;
  }
  return null;
}

export function nativePointForAnchor(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
) {
  const target = resolveNativeAnchorTarget(anchor, reader);
  if (!target && prototypeScreenIdForAnchor(anchor)) return null;
  const readerRect = reader.getBoundingClientRect();
  if (target) {
    const rect = target.getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        left:
          rect.left -
          readerRect.left +
          ((anchor.targetX ?? anchor.visualX ?? 50) / 100) * rect.width,
        top:
          rect.top -
          readerRect.top +
          ((anchor.targetY ?? anchor.visualY ?? 50) / 100) * rect.height,
      };
    }
  }
  return {
    left: (anchor.x / 100) * reader.scrollWidth - reader.scrollLeft,
    top: (anchor.y / 100) * reader.scrollHeight - reader.scrollTop,
  };
}

type NativeMarkerClip = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type NativeMarkerPlacement = {
  marker: {
    left: number;
    top: number;
  };
  clip: NativeMarkerClip | null;
};

function rectForElementWithinReader(element: HTMLElement, reader: HTMLElement) {
  const elementRect = element.getBoundingClientRect();
  if (!elementRect.width && !elementRect.height) return null;
  const readerRect = reader.getBoundingClientRect();
  return {
    left: elementRect.left - readerRect.left,
    top: elementRect.top - readerRect.top,
    width: elementRect.width,
    height: elementRect.height,
  } satisfies NativeMarkerClip;
}

function visualMarkerClipForAnchor(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
): NativeMarkerClip | null {
  const surfaceMode = visualSurfaceModeForAnchor(anchor);
  if (!surfaceMode) return null;
  const target = resolveNativeAnchorTarget(anchor, reader);
  const visualRoot =
    surfaceMode === "prototype"
      ? (target?.closest<HTMLElement>("[data-plan-prototype-viewer]") ??
        prototypeScopeForAnchor(anchor, reader)?.closest<HTMLElement>(
          "[data-plan-prototype-viewer]",
        ) ??
        reader.querySelector<HTMLElement>("[data-plan-prototype-viewer]"))
      : (target?.closest<HTMLElement>("[data-plan-canvas-viewport]") ??
        reader.querySelector<HTMLElement>("[data-plan-canvas-viewport]"));
  return visualRoot ? rectForElementWithinReader(visualRoot, reader) : null;
}

export function nativeMarkerPlacementForAnchor(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
): NativeMarkerPlacement | null {
  const point = nativePointForAnchor(anchor, reader);
  if (!point) return null;
  const clip = visualMarkerClipForAnchor(anchor, reader);
  if (!clip) return { marker: point, clip: null };
  return {
    clip,
    marker: {
      left: point.left - clip.left,
      top: point.top - clip.top,
    },
  };
}

export function visualSurfaceModeForAnchor(
  anchor: PlanAnnotationAnchor | null,
): PlanVisualSurfaceMode | null {
  if (!anchor) return null;
  const targetSelector = anchor.targetSelector ?? "";
  if (
    anchor.targetKind === "prototype" ||
    anchor.screenId ||
    prototypeScreenIdForAnchor(anchor)
  ) {
    return "prototype";
  }
  if (
    anchor.targetKind === "wireframe" ||
    anchor.targetKind === "canvas" ||
    anchor.planAnnotationId ||
    anchor.canvasX !== undefined ||
    anchor.canvasY !== undefined ||
    targetSelector.includes("data-plan-canvas-world") ||
    targetSelector.includes("plan-canvas-world") ||
    anchor.targetNodeId
  ) {
    return "wireframes";
  }
  return null;
}
