import { POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS } from "@/components/design/design-canvas/pending-text-edit";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";

import { queryUniqueSelector } from "./dom-utils";

/**
 * Why one begin-text-edit attempt did not end up in an editing session. These
 * stay distinct on purpose: a screen whose iframe is not mounted yet
 * ("no-iframe") is a retry-worthy race, while an iframe that answered and does
 * not have the node ("node-missing") or has it un-focused ("not-editing") is a
 * different situation entirely. Collapsing them all to `false` is what made the
 * board-space text bug invisible — every probe failed identically, so nothing
 * distinguished "asked the wrong window" from "user has not typed yet".
 */
export type BeginTextEditOutcome =
  | "active"
  | "done"
  | "node-missing"
  | "not-editing"
  | "no-iframe"
  | "no-reply"
  /** begin-text-edit was posted; the iframe has not been re-probed yet. Never
   *  settle on this — it is not evidence the node was abandoned, and the
   *  caller's exhaustion path deletes untouched nodes. */
  | "activation-requested";

export function isTextEditSessionOutcome(
  outcome: BeginTextEditOutcome,
): boolean {
  return outcome === "active" || outcome === "done";
}

/** Grace period before re-probing a just-requested activation. */
const ACTIVATION_CONFIRM_DELAY_MS = 300;

/**
 * Ask a single iframe's editor-chrome bridge whether a text-edit session for
 * `nodeId` is "active" (focused), "done" (non-empty committed text), or
 * neither. Replaces a direct `iframe.contentDocument` read: the bridge script
 * runs inside the iframe and already has `document.activeElement` available,
 * so it can answer the same question without the host needing same-origin
 * DOM access. See `agent-native:text-edit-status` in editor-chrome.bridge.ts.
 */
function queryTextEditStatus(
  iframe: HTMLIFrameElement,
  nodeId: string,
): Promise<"active" | "done" | "node-missing" | "not-editing" | "no-reply"> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve("no-reply");
  const correlationId = `text-edit-status-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      resolve("no-reply");
    }, 250);
    const listener = (event: MessageEvent) => {
      if (
        !event.data ||
        event.data.type !== "agent-native:text-edit-status-result" ||
        event.data.correlationId !== correlationId ||
        // Require the reply to come from the iframe we asked, not just any
        // window that happens to guess the correlationId.
        event.source !== win
      ) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      const status = event.data.status;
      if (status === "active" || status === "done") {
        resolve(status);
        return;
      }
      // Older bridges answer a bare `false` for both cases; treat that as
      // "present but not editing" so the retry ladder behaves as before.
      resolve(status === "missing" ? "node-missing" : "not-editing");
    };
    window.addEventListener("message", listener);
    win.postMessage(
      { type: "agent-native:text-edit-status", correlationId, nodeId },
      "*",
    );
  });
}

async function probeTextEdit(
  screenId: string | null,
  nodeId: string,
  boardFileId: string | null,
): Promise<BeginTextEditOutcome> {
  if (typeof document === "undefined" || !nodeId || !screenId) {
    return "no-iframe";
  }
  // The board surface's live iframe carries no `data-screen-iframe-id`, so the
  // old `dataset.screenIframeId === screenId` filter never matched it and every
  // attempt fell through to broadcasting at all the *screen* iframes — none of
  // which own a board node. findCanvasIframeForScreen is the one resolver that
  // already knows the board's `[data-board-surface-layer]` shape.
  const iframe = findCanvasIframeForScreen(
    document.body,
    screenId,
    boardFileId ?? undefined,
  );
  if (!iframe?.contentWindow) return "no-iframe";
  return queryTextEditStatus(iframe, nodeId);
}

/** Probes, and asks the iframe to enter edit mode when it is not already
 *  editing. Reports `activation-requested` rather than the status observed
 *  *before* the request: that pre-activation status is not an answer about the
 *  session it just asked for. */
async function requestTextEdit(
  screenId: string | null,
  nodeId: string,
  boardFileId: string | null,
): Promise<BeginTextEditOutcome> {
  const status = await probeTextEdit(screenId, nodeId, boardFileId);
  if (isTextEditSessionOutcome(status) || status === "no-iframe") return status;
  const iframe = findCanvasIframeForScreen(
    document.body,
    screenId ?? "",
    boardFileId ?? undefined,
  );
  if (!iframe?.contentWindow) return "no-iframe";
  iframe.contentWindow.postMessage(
    { type: "begin-text-edit", nodeId, force: true },
    "*",
  );
  return "activation-requested";
}

/**
 * T6: schedule retried "begin-text-edit" force-reopen attempts for a newly
 * created text node, but STOP retrying as soon as an edit session is
 * actually active in the iframe (previously this only stopped on "done" —
 * i.e. non-empty committed text — so an empty node the user hadn't typed
 * into yet, or had already pressed Escape on, kept getting force-reopened
 * for the full ~4.2s window). Returns a cancel function the caller can
 * invoke early (e.g. when the bridge reports the edit session ended via
 * Escape/blur) to stop any remaining scheduled retries immediately.
 *
 * `onExhausted` fires exactly once, either when a retry finally observes
 * "active"/"done" or when every retry ran out having only ever seen `false`
 * — the caller uses this to decide whether to clean up an empty node that
 * never got a real editing session.
 */
export function scheduleBeginTextEditForScreen(
  screenId: string | null,
  nodeId: string,
  options?: {
    /** Board file id, so a board-space text node resolves the board surface's
     *  iframe instead of looking for a `data-screen-iframe-id` it never has. */
    boardFileId?: string | null;
    onExhausted?: (finalStatus: BeginTextEditOutcome) => void;
  },
): () => void {
  if (typeof window === "undefined") return () => {};
  const onExhausted = options?.onExhausted;
  const boardFileId = options?.boardFileId ?? null;
  let finished = false;
  let lastStatus: BeginTextEditOutcome = "no-iframe";
  const timers: number[] = [];
  const settle = (status: BeginTextEditOutcome) => {
    if (finished) return;
    finished = true;
    lastStatus = status;
    timers.forEach((timer) => window.clearTimeout(timer));
    onExhausted?.(status);
  };
  const delays = [
    POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS,
    600,
    900,
    1200,
    1800,
    2400,
    3200,
    4200,
  ];
  delays.forEach((delay, index) => {
    const timer = window.setTimeout(() => {
      if (finished) return;
      void requestTextEdit(screenId, nodeId, boardFileId).then((status) => {
        if (finished) return;
        lastStatus = status;
        if (isTextEditSessionOutcome(status)) {
          settle(status);
          return;
        }
        if (index !== delays.length - 1) return;
        if (status !== "activation-requested") {
          settle(status);
          return;
        }
        // Activation is still in flight, and the caller deletes untouched nodes
        // on exhaustion. Settle on what the iframe reports, never on the request.
        const confirmTimer = window.setTimeout(() => {
          if (finished) return;
          void probeTextEdit(screenId, nodeId, boardFileId).then(
            (confirmed) => {
              if (finished) return;
              settle(confirmed);
            },
          );
        }, ACTIVATION_CONFIRM_DELAY_MS);
        timers.push(confirmTimer);
      });
    }, delay);
    timers.push(timer);
  });
  return () => {
    if (finished) return;
    settle(lastStatus);
  };
}

export function postShaderFillPreviewClearToPreviewIframes() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
    .forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          { type: "shader-fill-preview-clear" },
          "*",
        );
      } catch {
        // Ignore inaccessible iframe windows; same-origin previews handle this.
      }
    });
}

export function removeElementFromHtml(
  content: string,
  selector: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, selector);
    if (!element) return null;
    element.remove();
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

export function sanitizeEditableInnerHtml(html: string): string {
  if (typeof window === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<template>${html}</template>`,
      "text/html",
    );
    const fragment = doc.querySelector("template")?.content;
    if (!fragment) return html;
    fragment
      .querySelectorAll("script,style,iframe,object,embed,link,meta,base")
      .forEach((node) => node.remove());
    const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode() as Element | null;
    while (current) {
      for (const attr of Array.from(current.attributes)) {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value.trim().toLowerCase();
        if (
          attrName.startsWith("on") ||
          ((attrName === "href" ||
            attrName === "src" ||
            attrName === "xlink:href") &&
            attrValue.startsWith("javascript:"))
        ) {
          current.removeAttribute(attr.name);
        }
      }
      current = walker.nextNode() as Element | null;
    }
    return Array.from(fragment.childNodes)
      .map((node) =>
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element).outerHTML
          : (node.textContent ?? ""),
      )
      .join("");
  } catch {
    return html;
  }
}

export function updateElementContentInHtml(
  content: string,
  selector: string,
  text: string,
  html?: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = queryUniqueSelector(doc, selector);
    if (!element) return null;
    if (html !== undefined) {
      element.innerHTML = sanitizeEditableInnerHtml(html);
    } else {
      element.textContent = text;
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}
