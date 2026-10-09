import { normalizeJourneyPath } from "@shared/journey-path";
import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "@shared/session-replay-agent-access";

/**
 * Frame mode: `/sessions/:id?frame=1&agent_access=<token>` renders one
 * recording with no app chrome and no login, so a headless browser holding a
 * tokenized replay link can seek to an offset and screenshot it. The signed
 * token is the only credential; the replay data endpoints verify it.
 */
export const REPLAY_FRAME_QUERY_PARAM = "frame";

const USER_MESSAGE_SELECTOR =
  'article.agentkit-message[data-role="user"] .agentkit-user-message-text-content';
const MAX_USER_MESSAGE_COUNT = 12;
const MAX_USER_MESSAGE_CHARS = 2_000;
const MAX_USER_MESSAGE_TOTAL_CHARS = 8_000;
const NON_MESSAGE_TEXT_SELECTOR =
  'button, input, textarea, select, [contenteditable], [hidden], [aria-hidden="true"], script, style, template';

// `events` and `performance` are their own Sessions pages, not recordings.
const SESSION_DETAIL_PATH =
  /^\/sessions\/(?!(?:events|performance)\/?$)[^/]+\/?$/;

export function isReplayFrameRequest(
  pathname: string,
  search: string,
): boolean {
  if (!SESSION_DETAIL_PATH.test(pathname)) return false;
  const params = new URLSearchParams(search);
  return (
    params.get(REPLAY_FRAME_QUERY_PARAM) === "1" &&
    Boolean(params.get(SESSION_REPLAY_AGENT_ACCESS_PARAM))
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
  ).filter((element) => isVisibleMessageElement(element, document));
  const messages: ReplayFrameUserMessage[] = [];
  let totalCharacters = 0;
  let truncatedCharacters = false;
  for (const element of elements.slice(0, MAX_USER_MESSAGE_COUNT)) {
    const view = document.defaultView;
    const textWalker = document.createTreeWalker(
      element,
      view?.NodeFilter.SHOW_TEXT ?? 4,
    );
    const visibleText: string[] = [];
    let scannedCharacters = 0;
    let scanTruncated = false;
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
        if (view) {
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
      }
      if (included) {
        const remaining = MAX_USER_MESSAGE_CHARS + 1 - scannedCharacters;
        if (remaining <= 0) {
          scanTruncated = true;
          break;
        }
        const boundedNode = truncateReplayText(
          node.textContent ?? "",
          remaining,
        );
        visibleText.push(boundedNode.text);
        scannedCharacters += boundedNode.characters;
        scanTruncated ||= boundedNode.truncated;
        if (scanTruncated) break;
      }
      node = textWalker.nextNode();
    }
    const normalized = visibleText.join(" ").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const boundedMessage = truncateReplayText(
      normalized,
      MAX_USER_MESSAGE_CHARS,
    );
    truncatedCharacters ||= scanTruncated || boundedMessage.truncated;
    const remaining = MAX_USER_MESSAGE_TOTAL_CHARS - totalCharacters;
    if (remaining <= 0) {
      truncatedCharacters = true;
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
    truncatedMessages: elements.length > MAX_USER_MESSAGE_COUNT,
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
