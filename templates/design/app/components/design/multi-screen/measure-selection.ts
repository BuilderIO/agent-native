import type { ElementInfo } from "../types";

/**
 * Ask a screen's bridge to re-measure one element. An inspector commit never
 * reaches the bridge, so nothing else refreshes the geometry it just changed.
 */
export async function requestSelectionMeasurement(args: {
  /** A thunk, not a list: a frame that mounts between attempts must be seen. */
  targetWindows: () => (Window | null | undefined)[];
  /** The screen that owns the element. Breakpoint screens share node ids, so
   *  without this a positive match from the wrong screen wins the race. */
  screenId: string;
  selector?: string;
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<ElementInfo | null> {
  const attempts = Math.max(1, args.attempts ?? 3);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const measured = await measureOnce(args);
    if (measured) return measured;
    // An iframe can expose contentWindow before its bridge installs a message
    // listener, so the first post is silently dropped and nothing retries it.
    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, args.retryDelayMs ?? 150),
      );
    }
  }
  return null;
}

function measureOnce(args: {
  targetWindows: () => (Window | null | undefined)[];
  screenId: string;
  selector?: string;
  timeoutMs?: number;
}): Promise<ElementInfo | null> {
  const targets = args.targetWindows().filter((w): w is Window => Boolean(w));
  if (targets.length === 0) return Promise.resolve(null);
  const correlationId = `measure-${globalThis.crypto.randomUUID()}`;
  return new Promise((resolve) => {
    const settle = (value: ElementInfo | null) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(value);
    };
    const timer = window.setTimeout(() => settle(null), args.timeoutMs ?? 250);
    const listener = (event: MessageEvent) => {
      if (
        !event.data ||
        event.data.type !== "agent-native:selection-measured" ||
        event.data.correlationId !== correlationId ||
        event.data.screenId !== args.screenId ||
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
          screenId: args.screenId,
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
