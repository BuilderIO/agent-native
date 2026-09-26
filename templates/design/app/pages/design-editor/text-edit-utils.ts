import {
  BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS,
  BEGIN_TEXT_EDIT_RETRY_DELAYS_MS,
  TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS,
} from "@/components/design/design-canvas/pending-text-edit";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";
import type { ElementInfo } from "@/components/design/types";

import { queryUniqueSelector } from "./dom-utils";

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

export function endedTextEditClosesActiveSession(
  activeSession: { screenId: string; sourceId?: string } | null,
  ended: { screenId: string; sourceId?: string },
): boolean {
  if (!activeSession || activeSession.screenId !== ended.screenId) return false;
  if (!activeSession.sourceId) return !ended.sourceId;
  if (!ended.sourceId) return true;
  return activeSession.sourceId === ended.sourceId;
}

export function endedTextEditMatchesPendingCreation(
  pending: { screenId: string | null; nodeId: string } | null,
  ended: { active: boolean; screenId?: string; sourceId?: string },
): boolean {
  if (!pending || ended.active) return false;
  if (!ended.screenId || !ended.sourceId) return false;
  return (
    pending.screenId === ended.screenId && pending.nodeId === ended.sourceId
  );
}

export type TextEditRepeatIdentity = Pick<
  NonNullable<ElementInfo["repeat"]>,
  "sourceSelector" | "itemIndex"
>;

function queryTextEditStatus(
  iframe: HTMLIFrameElement,
  nodeId: string,
  repeat?: TextEditRepeatIdentity,
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
    }, TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS);
    const listener = (event: MessageEvent) => {
      if (
        !event.data ||
        event.data.type !== "agent-native:text-edit-status-result" ||
        event.data.correlationId !== correlationId ||
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
      resolve(status === "missing" ? "node-missing" : "not-editing");
    };
    window.addEventListener("message", listener);
    win.postMessage(
      { type: "agent-native:text-edit-status", correlationId, nodeId, repeat },
      "*",
    );
  });
}

async function probeTextEdit(
  screenId: string | null,
  nodeId: string,
  boardFileId: string | null,
  repeat?: TextEditRepeatIdentity,
): Promise<BeginTextEditOutcome> {
  if (typeof document === "undefined" || !nodeId || !screenId) {
    return "no-iframe";
  }
  const iframe = findCanvasIframeForScreen(
    document.body,
    screenId,
    boardFileId ?? undefined,
  );
  if (!iframe?.contentWindow) return "no-iframe";
  return queryTextEditStatus(iframe, nodeId, repeat);
}

async function requestTextEdit(
  screenId: string | null,
  nodeId: string,
  boardFileId: string | null,
  acceptCommittedText: boolean,
  isAbandoned: (() => boolean) | undefined,
  repeat?: TextEditRepeatIdentity,
): Promise<BeginTextEditOutcome> {
  const status = await probeTextEdit(screenId, nodeId, boardFileId, repeat);
  if (
    status === "active" ||
    (status === "done" && acceptCommittedText) ||
    status === "no-iframe"
  )
    return status;
  if (isAbandoned?.()) return status;
  const iframe = findCanvasIframeForScreen(
    document.body,
    screenId ?? "",
    boardFileId ?? undefined,
  );
  if (!iframe?.contentWindow) return "no-iframe";
  iframe.contentWindow.postMessage(
    { type: "begin-text-edit", nodeId, force: true, repeat },
    "*",
  );
  return "activation-requested";
}

export function scheduleBeginTextEditForScreen(
  screenId: string | null,
  nodeId: string,
  options?: {
    boardFileId?: string | null;
    reopenExisting?: boolean;
    isAbandoned?: () => boolean;
    repeat?: TextEditRepeatIdentity;
    onExhausted?: (finalStatus: BeginTextEditOutcome) => void;
  },
): () => void {
  if (typeof window === "undefined") return () => {};
  const onExhausted = options?.onExhausted;
  const boardFileId = options?.boardFileId ?? null;
  let finished = false;
  let activationRequested = false;
  let lastStatus: BeginTextEditOutcome = "no-iframe";
  const timers: number[] = [];
  const settle = (status: BeginTextEditOutcome) => {
    if (finished) return;
    finished = true;
    lastStatus = status;
    timers.forEach((timer) => window.clearTimeout(timer));
    onExhausted?.(status);
  };
  const delays = BEGIN_TEXT_EDIT_RETRY_DELAYS_MS;
  delays.forEach((delay, index) => {
    const timer = window.setTimeout(() => {
      if (finished) return;
      void requestTextEdit(
        screenId,
        nodeId,
        boardFileId,
        !options?.reopenExisting || activationRequested,
        options?.isAbandoned,
        options?.repeat,
      ).then((status) => {
        if (finished) return;
        if (status === "activation-requested") activationRequested = true;
        lastStatus = status;
        // An abandoned creation never settles early on a live session: the
        // caller has to decide the node's fate by its committed content, and
        // settling here would race the commit the stand-down click started.
        if (isTextEditSessionOutcome(status) && !options?.isAbandoned?.()) {
          settle(status);
          return;
        }
        if (index !== delays.length - 1) return;
        if (status !== "activation-requested") {
          settle(status);
          return;
        }
        const confirmTimer = window.setTimeout(() => {
          if (finished) return;
          void probeTextEdit(
            screenId,
            nodeId,
            boardFileId,
            options?.repeat,
          ).then((confirmed) => {
            if (finished) return;
            settle(confirmed);
          });
        }, BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS);
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
