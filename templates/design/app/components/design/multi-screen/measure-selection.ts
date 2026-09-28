import type { ElementInfo } from "../types";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "./iframe-targeting";

export async function requestSelectionMeasurement(args: {
  targetWindows: () => (Window | null | undefined)[];
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
        !targets.includes(event.source as Window)
      ) {
        return;
      }
      const payload: unknown = event.data.payload;
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

export function designPreviewWindows(): Window[] {
  return [
    ...document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe], iframe[data-screen-iframe-id]",
    ),
  ]
    .map((iframe) => iframe.contentWindow)
    .filter((w): w is Window => Boolean(w));
}

export function designPreviewWindowsForScreen(
  screenId: string,
  breakpointWidth?: number,
  boardFileId?: string,
): Window[] {
  if (typeof document === "undefined") return [];
  const iframeId =
    boardFileId && screenId === boardFileId
      ? boardFileId
      : breakpointWidth === undefined
        ? screenId
        : getBreakpointIframeId(screenId, breakpointWidth);
  const iframe = findCanvasIframeForScreen(
    document.body,
    iframeId,
    boardFileId,
  );
  return iframe?.contentWindow ? [iframe.contentWindow] : [];
}
