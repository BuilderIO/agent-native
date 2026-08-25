import type { ElementInfo } from "../types";

/**
 * Ask a screen's bridge to re-measure one element. An inspector commit never
 * reaches the bridge, so nothing else refreshes the geometry it just changed.
 */
export function requestSelectionMeasurement(args: {
  targetWindows: (Window | null | undefined)[];
  selector?: string;
  timeoutMs?: number;
}): Promise<ElementInfo | null> {
  const targets = args.targetWindows.filter((w): w is Window => Boolean(w));
  if (targets.length === 0) return Promise.resolve(null);
  const correlationId = `measure-${globalThis.crypto.randomUUID()}`;
  return new Promise((resolve) => {
    const settle = (value: ElementInfo | null) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(value);
    };
    const timer = window.setTimeout(() => settle(null), args.timeoutMs ?? 500);
    const listener = (event: MessageEvent) => {
      if (
        !event.data ||
        event.data.type !== "agent-native:selection-measured" ||
        event.data.correlationId !== correlationId ||
        // Only a frame that was asked may answer.
        !targets.includes(event.source as Window)
      ) {
        return;
      }
      const payload: unknown = event.data.payload;
      // Frames that do not contain the element answer null; keep waiting for
      // the one that does rather than settling on the first reply.
      if (
        payload &&
        typeof payload === "object" &&
        typeof (payload as ElementInfo).tagName === "string" &&
        (payload as ElementInfo).boundingRect
      ) {
        settle(payload as ElementInfo);
      }
    };
    window.addEventListener("message", listener);
    for (const target of targets) {
      target.postMessage(
        {
          type: "agent-native:measure-selection",
          correlationId,
          selector: args.selector,
        },
        "*",
      );
    }
  });
}

/** Every live screen/board preview frame, in either canvas mode. */
export function designPreviewWindows(): Window[] {
  return [
    ...document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe], iframe[data-screen-iframe-id]",
    ),
  ]
    .map((iframe) => iframe.contentWindow)
    .filter((w): w is Window => Boolean(w));
}
