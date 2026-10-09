import {
  readPaintLayers,
  resolveTextBackground,
  type TextBackground,
} from "@shared/text-background";

import { designPreviewWindows } from "./measure-selection";

const DEFAULT_TIMEOUT_MS = 400;

/**
 * Asks the canvas iframe for the paint behind a text layer and resolves it to
 * a solid color. A screen that cannot answer (an external URL, a bridge that
 * is not running, an iframe that is gone) is `unavailable`, never a guess.
 */
export function requestTextBackground(args: {
  screenId: string;
  selector: string;
  targetWindows?: () => (Window | null | undefined)[];
  timeoutMs?: number;
}): Promise<TextBackground> {
  const targets = (args.targetWindows ?? designPreviewWindows)().filter(
    (target): target is Window => Boolean(target),
  );
  if (targets.length === 0) {
    return Promise.resolve({ kind: "unavailable", reason: "no-screen" });
  }
  const correlationId = `contrast-${globalThis.crypto.randomUUID()}`;
  return new Promise((resolve) => {
    const settle = (background: TextBackground) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(background);
    };
    const timer = window.setTimeout(
      () => settle({ kind: "unavailable", reason: "no-screen" }),
      args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const listener = (event: MessageEvent) => {
      if (
        !event.data ||
        event.data.type !== "agent-native:contrast-background-measured" ||
        event.data.correlationId !== correlationId ||
        !targets.includes(event.source as Window) ||
        (args.screenId && event.data.screenId !== args.screenId)
      ) {
        return;
      }
      const layers = readPaintLayers(event.data.payload);
      settle(
        layers
          ? resolveTextBackground(layers)
          : { kind: "unavailable", reason: "bad-reply" },
      );
    };
    window.addEventListener("message", listener);
    for (const target of targets) {
      target.postMessage(
        {
          type: "agent-native:measure-contrast-background",
          correlationId,
          screenId: args.screenId,
          selector: args.selector,
        },
        "*",
      );
    }
  });
}
