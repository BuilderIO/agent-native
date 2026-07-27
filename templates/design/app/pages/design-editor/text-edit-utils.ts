import { POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS } from "@/components/design/design-canvas/pending-text-edit";

import { queryUniqueSelector } from "./dom-utils";

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
): Promise<"active" | "done" | false> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve(false);
  const correlationId = `text-edit-status-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      resolve(false);
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
      resolve(status === "active" || status === "done" ? status : false);
    };
    window.addEventListener("message", listener);
    win.postMessage(
      { type: "agent-native:text-edit-status", correlationId, nodeId },
      "*",
    );
  });
}

async function postBeginTextEditToPreviewIframes(
  screenId: string | null,
  nodeId: string,
): Promise<"active" | "done" | false> {
  if (typeof document === "undefined" || !nodeId) return false;
  const iframes = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    ),
  );
  const targetIframes = iframes.filter(
    (iframe) => screenId && iframe.dataset.screenIframeId === screenId,
  );
  const orderedIframes = targetIframes.length > 0 ? targetIframes : iframes;
  for (const iframe of orderedIframes) {
    const status = await queryTextEditStatus(iframe, nodeId);
    if (status === "active" || status === "done") return status;
  }
  orderedIframes.forEach((iframe) => {
    iframe.contentWindow?.postMessage(
      { type: "begin-text-edit", nodeId, force: true },
      "*",
    );
  });
  return false;
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
  onExhausted?: (finalStatus: "active" | "done" | false) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let finished = false;
  let lastStatus: "active" | "done" | false = false;
  const timers: number[] = [];
  const settle = (status: "active" | "done" | false) => {
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
      void postBeginTextEditToPreviewIframes(screenId, nodeId).then(
        (status) => {
          if (finished) return;
          lastStatus = status;
          if (status === "active" || status === "done") {
            settle(status);
            return;
          }
          if (index === delays.length - 1) {
            settle(false);
          }
        },
      );
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
