import { normalizeJourneyPath } from "@shared/journey-path";
import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "@shared/session-replay-agent-access";
import {
  MAX_SESSION_REPLAY_CAPTURE_OFFSET_MS,
  SESSION_REPLAY_CAPTURE_THROUGH_MS_PARAM,
} from "@shared/session-replay-capture";

/**
 * Frame mode renders one recording without app chrome. The signed token is
 * scoped to the recording; `capture_through_ms` bounds the loaded prefix.
 */
export const REPLAY_FRAME_QUERY_PARAM = "frame";

const USER_MESSAGE_SELECTOR =
  'article.agentkit-message[data-role="user"] .agentkit-user-message-text-content';
const MAX_USER_MESSAGE_COUNT = 12;
const MAX_USER_MESSAGE_CANDIDATES = 200;
const MAX_USER_MESSAGE_CHARS = 2_000;
const MAX_USER_MESSAGE_TOTAL_CHARS = 8_000;
const MAX_REPLAY_DOM_NODES = 8_192;
const MAX_REPLAY_OCCLUSIONS = 64;
const MAX_REPLAY_DOM_ANCESTOR_DEPTH = 128;
const MAX_USER_MESSAGE_SCAN_NODES = 1_024;
const MAX_USER_MESSAGE_SCAN_CHARS = 32_000;
const NON_MESSAGE_TEXT_SELECTOR =
  'button, input, textarea, select, [contenteditable], [hidden], [aria-hidden="true"], script, style, template';

// `events` and `performance` are their own Sessions pages, not recordings.
const SESSION_DETAIL_PATH =
  /^\/sessions\/(?!(?:events|performance)\/?$)[^/]+\/?$/;

type ReplayTextRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type ReplayTextOcclusion = { element: Element; rect: ReplayTextRect };
type ReplayTextScanBudget = {
  characters: number;
  exhausted: boolean;
  nodes: number;
};

function replayTextColorIsTransparent(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  if (normalized === "transparent") return true;
  const slashAlpha = /\/\s*([\d.]+)%?\s*\)$/.exec(normalized)?.[1];
  if (slashAlpha !== undefined) return Number(slashAlpha) === 0;
  if (/^(?:rgba|hsla)\(/.test(normalized)) {
    const components = normalized
      .slice(normalized.indexOf("(") + 1, -1)
      .split(",");
    const alpha = components[components.length - 1]?.trim();
    return alpha !== undefined && Number.parseFloat(alpha) === 0;
  }
  return false;
}

function replayTextLayoutIsHidden(style: CSSStyleDeclaration): boolean {
  const blurredText = Array.from(
    style.filter.matchAll(/blur\(([^)]*)\)/gi),
  ).some(
    ([, radius]) =>
      !/^0(?:\.0+)?(?:px|rem|em|in|cm|mm|pt|pc|vh|vw)?$/i.test(
        (radius ?? "").trim(),
      ),
  );
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.contentVisibility === "hidden" ||
    (style.opacity !== "" && Number(style.opacity) === 0) ||
    /opacity\(\s*0(?:\.0+)?%?\s*\)/i.test(style.filter) ||
    blurredText
  );
}

function replayTextStyleIsHidden(style: CSSStyleDeclaration): boolean {
  return (
    replayTextLayoutIsHidden(style) ||
    replayTextColorIsTransparent(style.color) ||
    replayTextColorIsTransparent(
      style.getPropertyValue("-webkit-text-fill-color"),
    ) ||
    !["", "none"].includes(
      style.getPropertyValue("-webkit-text-security").trim(),
    )
  );
}

function replayUserMessageElements(document: Document): {
  elements: HTMLElement[];
  truncated: boolean;
} {
  const view = document.defaultView;
  if (!view) throw new Error("replay_text_geometry_unavailable");
  const walker = document.createTreeWalker(
    document.documentElement,
    view.NodeFilter.SHOW_ALL,
  );
  const elements: HTMLElement[] = [];
  const nodeDepths = new WeakMap<Node, number>();
  let scannedNodes = 0;
  let current = walker.nextNode();
  while (current) {
    if (++scannedNodes > MAX_REPLAY_DOM_NODES) {
      throw new Error("replay_text_dom_limit_exceeded");
    }
    const parentDepth =
      current.parentNode === document.documentElement
        ? 0
        : nodeDepths.get(current.parentNode!);
    if (
      parentDepth === undefined ||
      parentDepth >= MAX_REPLAY_DOM_ANCESTOR_DEPTH
    ) {
      throw new Error("replay_text_dom_limit_exceeded");
    }
    nodeDepths.set(current, parentDepth + 1);
    if (
      current.nodeType === 1 &&
      (current as HTMLElement).matches(USER_MESSAGE_SELECTOR)
    ) {
      if (elements.length >= MAX_USER_MESSAGE_CANDIDATES) {
        return { elements, truncated: true };
      }
      elements.push(current as HTMLElement);
    }
    current = walker.nextNode();
  }
  return { elements, truncated: false };
}

function replayTextHasPositionedPseudoOverlay(
  element: HTMLElement,
  document: Document,
  checkedPseudoOverlays: WeakMap<Element, boolean>,
): boolean {
  const view = document.defaultView;
  if (!view) throw new Error("replay_text_occlusion_unverifiable");
  let depth = 0;
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    if (++depth > MAX_REPLAY_DOM_ANCESTOR_DEPTH) {
      throw new Error("replay_text_dom_limit_exceeded");
    }
    const cached = checkedPseudoOverlays.get(current);
    if (cached !== undefined) {
      if (cached) return true;
      continue;
    }
    let hasOverlay = false;
    for (const pseudo of ["::before", "::after"]) {
      let style: CSSStyleDeclaration;
      try {
        style = view.getComputedStyle(current, pseudo);
      } catch {
        throw new Error("replay_text_occlusion_unverifiable");
      }
      const content = style.content.trim();
      if (
        !content ||
        content === "none" ||
        content === "normal" ||
        replayTextLayoutIsHidden(style)
      ) {
        continue;
      }
      if (
        style.pointerEvents === "none" ||
        style.position !== "static" ||
        style.transform !== "none" ||
        style.zIndex !== "auto"
      ) {
        hasOverlay = true;
        break;
      }
    }
    checkedPseudoOverlays.set(current, hasOverlay);
    if (hasOverlay) return true;
  }
  return false;
}

function intersectReplayRects(
  first: ReplayTextRect,
  second: ReplayTextRect,
): ReplayTextRect | null {
  const rect = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

function replayTextClipRect(
  element: Element,
  document: Document,
): ReplayTextRect | null {
  const view = document.defaultView;
  const viewportWidth = Number(view?.innerWidth ?? 0);
  const viewportHeight = Number(view?.innerHeight ?? 0);
  if (
    !view ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    throw new Error("replay_text_geometry_unavailable");
  }
  let clip: ReplayTextRect = {
    left: 0,
    top: 0,
    right: viewportWidth,
    bottom: viewportHeight,
  };

  let depth = 0;
  for (
    let current: Element | null = element;
    current && current !== document.documentElement;
    current = current.parentElement
  ) {
    if (++depth > MAX_REPLAY_DOM_ANCESTOR_DEPTH) {
      throw new Error("replay_text_dom_limit_exceeded");
    }
    const style = view.getComputedStyle(current);
    const transform = style.transform;
    if (
      (transform &&
        transform !== "none" &&
        !/^matrix\(1(?:\.0+)?,\s*0,\s*0,\s*1(?:\.0+)?,\s*[-\d.e+]+,\s*[-\d.e+]+\)$/.test(
          transform,
        )) ||
      (style.rotate && style.rotate !== "none" && style.rotate !== "0deg") ||
      (style.scale && style.scale !== "none" && style.scale !== "1") ||
      (style.clipPath && style.clipPath !== "none") ||
      (style.maskImage && style.maskImage !== "none") ||
      (style.clip && style.clip !== "auto")
    ) {
      throw new Error("replay_text_geometry_unverifiable");
    }
    if (
      current.matches('[hidden], [aria-hidden="true"]') ||
      replayTextStyleIsHidden(style)
    ) {
      return null;
    }

    const contain = style.contain.split(/\s+/);
    const clipsX = /^(?:hidden|clip|scroll|auto|overlay)$/.test(
      style.overflowX || style.overflow,
    );
    const clipsY = /^(?:hidden|clip|scroll|auto|overlay)$/.test(
      style.overflowY || style.overflow,
    );
    const clipsPaint =
      contain.includes("paint") ||
      style.contain === "strict" ||
      style.contain === "content";
    if (!clipsX && !clipsY && !clipsPaint) continue;
    if (style.borderRadius && style.borderRadius !== "0px") {
      throw new Error("replay_text_geometry_unverifiable");
    }

    const box = current.getBoundingClientRect();
    const htmlElement = current as HTMLElement;
    const borderLeft = htmlElement.clientLeft;
    const borderTop = htmlElement.clientTop;
    const clientWidth = htmlElement.clientWidth;
    const clientHeight = htmlElement.clientHeight;
    if ((clipsX && clientWidth <= 0) || (clipsY && clientHeight <= 0)) {
      return null;
    }
    const boxClip: ReplayTextRect = {
      left: clipsX || clipsPaint ? box.left + borderLeft : clip.left,
      top: clipsY || clipsPaint ? box.top + borderTop : clip.top,
      right:
        clipsX || clipsPaint ? box.left + borderLeft + clientWidth : clip.right,
      bottom:
        clipsY || clipsPaint ? box.top + borderTop + clientHeight : clip.bottom,
    };
    const intersection = intersectReplayRects(clip, boxClip);
    if (!intersection) return null;
    clip = intersection;
  }

  return clip;
}

function replayTextOcclusionRects(document: Document): ReplayTextOcclusion[] {
  const view = document.defaultView;
  if (!view || typeof document.elementFromPoint !== "function") {
    throw new Error("replay_text_occlusion_unverifiable");
  }
  const walker = document.createTreeWalker(
    document.documentElement,
    view.NodeFilter.SHOW_ALL,
  );
  const elements: HTMLElement[] = [];
  const textAncestors = new WeakSet<Element>();
  const nodeDepths = new WeakMap<Node, number>();
  let scannedNodes = 0;
  let current = walker.nextNode();
  while (current) {
    if (++scannedNodes > MAX_REPLAY_DOM_NODES) {
      throw new Error("replay_text_occlusion_limit_exceeded");
    }
    const parentDepth =
      current.parentNode === document.documentElement
        ? 0
        : nodeDepths.get(current.parentNode!);
    if (
      parentDepth === undefined ||
      parentDepth >= MAX_REPLAY_DOM_ANCESTOR_DEPTH
    ) {
      throw new Error("replay_text_dom_limit_exceeded");
    }
    nodeDepths.set(current, parentDepth + 1);
    if (current.nodeType === 1) {
      elements.push(current as HTMLElement);
    } else if (current.nodeType === 3) {
      let depth = 0;
      for (
        let parent = current.parentElement;
        parent && parent !== document.documentElement;
        parent = parent.parentElement
      ) {
        if (++depth > MAX_REPLAY_DOM_ANCESTOR_DEPTH) {
          throw new Error("replay_text_dom_limit_exceeded");
        }
        textAncestors.add(parent);
      }
    }
    current = walker.nextNode();
  }

  const occlusionRects: ReplayTextOcclusion[] = [];
  for (const element of elements) {
    const style = view.getComputedStyle(element);
    const pointerTransparent = style.pointerEvents === "none";
    const positioned =
      style.position !== "static" ||
      style.transform !== "none" ||
      style.zIndex !== "auto";
    const painted =
      style.backgroundImage !== "none" ||
      element.matches("img, video, canvas, iframe, object, embed, svg") ||
      (style.backgroundColor !== "" &&
        !replayTextColorIsTransparent(style.backgroundColor)) ||
      (style.boxShadow !== "" && style.boxShadow !== "none");
    if (
      // elementFromPoint misses transparent layers and samples can miss thin overlays.
      (pointerTransparent ||
        (positioned && (painted || textAncestors.has(element)))) &&
      !replayTextLayoutIsHidden(style)
    ) {
      const rect = element.getBoundingClientRect();
      if (
        ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
      ) {
        throw new Error("replay_text_occlusion_unverifiable");
      }
      if (rect.right > rect.left && rect.bottom > rect.top) {
        if (occlusionRects.length >= MAX_REPLAY_OCCLUSIONS) {
          throw new Error("replay_text_occlusion_limit_exceeded");
        }
        occlusionRects.push({
          element,
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          },
        });
      }
    }
  }
  return occlusionRects;
}

function replayTextIsUnobscured(
  node: Node,
  rect: DOMRect,
  clip: ReplayTextRect,
  document: Document,
  pointerTransparentOcclusions: ReplayTextOcclusion[],
): boolean {
  const visibleRect = intersectReplayRects(clip, rect);
  if (!visibleRect) return false;
  if (
    pointerTransparentOcclusions.some(
      ({ element: occlusionElement, rect: occlusionRect }) =>
        !occlusionElement.contains(node) &&
        intersectReplayRects(visibleRect, occlusionRect) !== null,
    )
  ) {
    return false;
  }
  const samplePoints = [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ] as const;
  try {
    return samplePoints.every(([xRatio, yRatio]) => {
      const pointX =
        visibleRect.left + (visibleRect.right - visibleRect.left) * xRatio;
      const pointY =
        visibleRect.top + (visibleRect.bottom - visibleRect.top) * yRatio;
      const hit = document.elementFromPoint(pointX, pointY);
      if (!hit) throw new Error("replay_text_occlusion_unverifiable");
      if (hit === node.parentElement) return true;
      if (hit.contains(node)) {
        throw new Error("replay_text_occlusion_unverifiable");
      }
      return false;
    });
  } catch {
    throw new Error("replay_text_occlusion_unverifiable");
  }
}

function visibleTextForMessage(
  element: HTMLElement,
  document: Document,
  pointerTransparentOcclusions: ReplayTextOcclusion[],
  scanBudget: ReplayTextScanBudget,
): { text: string; truncated: boolean } {
  const view = document.defaultView;
  if (!view) throw new Error("replay_text_geometry_unavailable");
  const textWalker = document.createTreeWalker(
    element,
    view.NodeFilter.SHOW_TEXT,
  );
  const range = document.createRange();
  const checkedPseudoOverlays = new WeakMap<Element, boolean>();
  if (typeof range.getClientRects !== "function") {
    throw new Error("replay_text_geometry_unavailable");
  }
  const visibleText: string[] = [];
  let scannedCharacters = 0;
  let truncated = false;
  let node = textWalker.nextNode();
  while (node) {
    const currentNode = node;
    const text = currentNode.textContent ?? "";
    if (
      ++scanBudget.nodes > MAX_USER_MESSAGE_SCAN_NODES ||
      scanBudget.characters + text.length > MAX_USER_MESSAGE_SCAN_CHARS
    ) {
      scanBudget.exhausted = true;
      truncated = true;
      break;
    }
    scanBudget.characters += text.length;
    let included = true;
    let depth = 0;
    for (
      let parent = currentNode.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (++depth > MAX_REPLAY_DOM_ANCESTOR_DEPTH) {
        throw new Error("replay_text_dom_limit_exceeded");
      }
      if (parent.matches(NON_MESSAGE_TEXT_SELECTOR)) {
        included = false;
        break;
      }
      const style = view.getComputedStyle(parent);
      if (replayTextStyleIsHidden(style)) {
        included = false;
        break;
      }
    }
    if (
      included &&
      replayTextHasPositionedPseudoOverlay(
        currentNode.parentElement ?? element,
        document,
        checkedPseudoOverlays,
      )
    ) {
      throw new Error("replay_text_occlusion_unverifiable");
    }
    const clip = included
      ? replayTextClipRect(currentNode.parentElement ?? element, document)
      : null;
    let offset = 0;
    while (included && clip && offset < text.length) {
      if (scannedCharacters >= MAX_USER_MESSAGE_CHARS + 1) {
        truncated = true;
        break;
      }
      const codePoint = text.codePointAt(offset)!;
      const nextOffset = offset + (codePoint > 0xffff ? 2 : 1);
      range.setStart(currentNode, offset);
      range.setEnd(currentNode, nextOffset);
      const rangeRects = range.getClientRects();
      if (rangeRects.length > 16) {
        throw new Error("replay_text_geometry_unverifiable");
      }
      const hasVisibleRect = Array.from(rangeRects).some(
        (rect) =>
          Number.isFinite(rect.left) &&
          Number.isFinite(rect.top) &&
          rect.right > rect.left &&
          rect.bottom > rect.top &&
          replayTextIsUnobscured(
            currentNode,
            rect,
            clip,
            document,
            pointerTransparentOcclusions,
          ),
      );
      if (hasVisibleRect) visibleText.push(text.slice(offset, nextOffset));
      offset = nextOffset;
      scannedCharacters += 1;
    }
    if (truncated || (included && clip && offset < text.length)) {
      truncated = true;
      break;
    }
    node = textWalker.nextNode();
  }
  return { text: visibleText.join(""), truncated };
}

export function isReplayFrameRequest(
  pathname: string,
  search: string,
): boolean {
  if (!SESSION_DETAIL_PATH.test(pathname)) return false;
  const params = new URLSearchParams(search);
  const captureThroughOffset = params.get(
    SESSION_REPLAY_CAPTURE_THROUGH_MS_PARAM,
  );
  const captureThroughOffsetMs = Number(captureThroughOffset);
  return (
    params.get(REPLAY_FRAME_QUERY_PARAM) === "1" &&
    Boolean(params.get(SESSION_REPLAY_AGENT_ACCESS_PARAM)) &&
    captureThroughOffset !== null &&
    /^(?:0|[1-9]\d*)$/.test(captureThroughOffset) &&
    Number.isSafeInteger(captureThroughOffsetMs) &&
    captureThroughOffsetMs <= MAX_SESSION_REPLAY_CAPTURE_OFFSET_MS
  );
}

export type ReplayFrameCapture = {
  /** Offset from the recording's startedAt, matching JourneyTree examples. */
  offsetMs: number;
  /** rrweb's first-event-relative playhead used to render this capture. */
  playheadOffsetMs: number;
  width: number;
  height: number;
  /** Path the recording was on at this offset; empty when it cannot be told. */
  route: string;
  capturedAt: string;
  /** PNG bytes, base64 encoded. */
  png: string;
};

export type ReplayFrameUserMessage = {
  role: "user";
  text: string;
};

export type ReplayFrameUserMessageSnapshot = {
  observedOffsetMs: number;
  playheadOffsetMs: number;
  observedAt: string;
  messages: ReplayFrameUserMessage[];
  truncatedMessages: boolean;
  truncatedCharacters: boolean;
};

function isVisibleMessageElement(element: HTMLElement, document: Document) {
  const view = document.defaultView;
  let depth = 0;
  for (let current: Element | null = element; current; ) {
    if (++depth > MAX_REPLAY_DOM_ANCESTOR_DEPTH) {
      throw new Error("replay_text_dom_limit_exceeded");
    }
    if (current.matches('[hidden], [aria-hidden="true"]')) return false;
    if (view) {
      const style = view.getComputedStyle(current);
      if (replayTextStyleIsHidden(style)) return false;
    }
    current = current.parentElement;
  }
  return true;
}

/**
 * A recorded route as the shared capture manifest lists it: path only, with
 * the same dynamic-segment naming as the journey tree. A recorded query, hash,
 * or path segment can carry codes or personal data.
 */
export function replayFramePath(route: string): string {
  return normalizeJourneyPath(route) ?? "";
}

/** What a driver reads from `window.__anReplayFrame`. */
export type ReplayFrameApi =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | {
      status: "ready";
      recordingId: string;
      recordingStartedAt: string;
      totalTimeMs: number;
      eventCount: number;
      capture(recordingOffsetMs: number): Promise<ReplayFrameCapture>;
      extractUserMessages(
        recordingOffsetMs: number,
      ): Promise<ReplayFrameUserMessageSnapshot>;
    };

declare global {
  interface Window {
    __anReplayFrame?: ReplayFrameApi;
  }
}

/** A stable reason string for a driver to report; never a stack or a URL. */
export function replayFrameFailureReason(error: unknown): string {
  // By name, so the root route can import this file without the screenshot
  // compositor.
  if (error instanceof Error && error.name === "ReplayScreenshotAssetError") {
    return "assets_not_capturable";
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/(https?:\/\/[^\s"'?#]*)\?[^\s"'#]*/gi, "$1?[redacted]")
      .replace(/\s+/g, " ")
      .slice(0, 200) || "unknown_error"
  );
}

function truncateReplayText(
  text: string,
  maxCharacters: number,
): { characters: number; text: string; truncated: boolean } {
  let end = 0;
  let characters = 0;
  while (end < text.length && characters < maxCharacters) {
    const codePoint = text.codePointAt(end)!;
    end += codePoint > 0xffff ? 2 : 1;
    characters += 1;
  }
  return { characters, text: text.slice(0, end), truncated: end < text.length };
}

/** Reads only the visible text component rendered for user-role chat messages. */
export function extractVisibleReplayUserMessages(
  document: Document | null,
  observedOffsetMs: number,
  playheadOffsetMs: number,
  observedAt: string,
): ReplayFrameUserMessageSnapshot {
  if (
    !Number.isFinite(observedOffsetMs) ||
    observedOffsetMs < 0 ||
    !Number.isFinite(playheadOffsetMs) ||
    playheadOffsetMs < 0
  ) {
    throw new Error("prompt_provenance_seek_invalid");
  }
  if (!document) throw new Error("replay_document_unavailable");

  const { elements, truncated: truncatedCandidateElements } =
    replayUserMessageElements(document);
  const pointerTransparentOcclusions =
    elements.length > 0 ? replayTextOcclusionRects(document) : [];
  const messages: ReplayFrameUserMessage[] = [];
  let totalCharacters = 0;
  let truncatedCharacters = false;
  const scanBudget = { characters: 0, exhausted: false, nodes: 0 };
  let truncatedMessages = truncatedCandidateElements;
  for (const element of elements) {
    if (!isVisibleMessageElement(element, document)) continue;
    const visibleText = visibleTextForMessage(
      element,
      document,
      pointerTransparentOcclusions,
      scanBudget,
    );
    truncatedCharacters ||= visibleText.truncated;
    if (scanBudget.exhausted) truncatedMessages = true;
    const normalized = visibleText.text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      if (scanBudget.exhausted) break;
      continue;
    }
    if (messages.length >= MAX_USER_MESSAGE_COUNT) {
      truncatedMessages = true;
      break;
    }
    const boundedMessage = truncateReplayText(
      normalized,
      MAX_USER_MESSAGE_CHARS,
    );
    truncatedCharacters ||= boundedMessage.truncated;
    const remaining = MAX_USER_MESSAGE_TOTAL_CHARS - totalCharacters;
    if (remaining <= 0) {
      truncatedCharacters = true;
      truncatedMessages = true;
      break;
    }
    const boundedTotal = truncateReplayText(boundedMessage.text, remaining);
    truncatedCharacters ||= boundedTotal.truncated;
    messages.push({ role: "user", text: boundedTotal.text });
    totalCharacters += boundedTotal.characters;
    if (scanBudget.exhausted) break;
  }

  return {
    observedOffsetMs,
    playheadOffsetMs,
    observedAt,
    messages,
    truncatedMessages,
    truncatedCharacters,
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("screenshot_unreadable"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (!result.startsWith("data:") || comma === -1) {
        reject(new Error("screenshot_unreadable"));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}
