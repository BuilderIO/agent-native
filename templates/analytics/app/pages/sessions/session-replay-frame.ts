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

  for (
    let current: Element | null = element;
    current && current !== document.documentElement;
    current = current.parentElement
  ) {
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
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      (style.opacity !== "" && Number(style.opacity) === 0)
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

function visibleTextForMessage(
  element: HTMLElement,
  document: Document,
): { text: string; truncated: boolean } {
  const view = document.defaultView;
  if (!view) throw new Error("replay_text_geometry_unavailable");
  const textWalker = document.createTreeWalker(
    element,
    view.NodeFilter.SHOW_TEXT,
  );
  const range = document.createRange();
  if (typeof range.getClientRects !== "function") {
    throw new Error("replay_text_geometry_unavailable");
  }
  const visibleText: string[] = [];
  let scannedCharacters = 0;
  let truncated = false;
  let node = textWalker.nextNode();
  while (node) {
    let included = true;
    for (
      let parent = node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.matches(NON_MESSAGE_TEXT_SELECTOR)) {
        included = false;
        break;
      }
      const style = view.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        (style.opacity !== "" && Number(style.opacity) === 0)
      ) {
        included = false;
        break;
      }
    }
    const clip = included
      ? replayTextClipRect(node.parentElement ?? element, document)
      : null;
    const text = node.textContent ?? "";
    let offset = 0;
    while (included && clip && offset < text.length) {
      if (scannedCharacters >= MAX_USER_MESSAGE_CHARS + 1) {
        truncated = true;
        break;
      }
      const codePoint = text.codePointAt(offset)!;
      const nextOffset = offset + (codePoint > 0xffff ? 2 : 1);
      range.setStart(node, offset);
      range.setEnd(node, nextOffset);
      const hasVisibleRect = Array.from(range.getClientRects()).some(
        (rect) =>
          Number.isFinite(rect.left) &&
          Number.isFinite(rect.top) &&
          rect.right > rect.left &&
          rect.bottom > rect.top &&
          intersectReplayRects(clip, rect)?.right !== undefined,
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
  for (let current: Element | null = element; current; ) {
    if (current.matches('[hidden], [aria-hidden="true"]')) return false;
    if (view) {
      const style = view.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        (style.opacity !== "" && Number(style.opacity) === 0)
      ) {
        return false;
      }
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

  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR),
  );
  const messages: ReplayFrameUserMessage[] = [];
  let totalCharacters = 0;
  let truncatedCharacters = false;
  let scannedCandidates = 0;
  let truncatedMessages = false;
  for (const element of elements) {
    if (++scannedCandidates > MAX_USER_MESSAGE_CANDIDATES) {
      truncatedMessages = true;
      break;
    }
    if (!isVisibleMessageElement(element, document)) continue;
    const visibleText = visibleTextForMessage(element, document);
    const normalized = visibleText.text.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    if (messages.length >= MAX_USER_MESSAGE_COUNT) {
      truncatedMessages = true;
      break;
    }
    const boundedMessage = truncateReplayText(
      normalized,
      MAX_USER_MESSAGE_CHARS,
    );
    truncatedCharacters ||= visibleText.truncated || boundedMessage.truncated;
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
