import { hasFigmaClipboardMarkers } from "@shared/design-tool-markers";
import { base64ToBytes } from "@shared/fig-bytes";
import {
  decodeFigmaClipboardFrames,
  MAX_CLIPBOARD_BUFFER_BYTES,
  type DecodedFigmaClipboard,
} from "@shared/figma-clipboard-decode";

import { extractFigmaBuffer } from "@/lib/figma-clipboard";

import type { FigmaPasteWorkerResponse } from "./figma-paste.worker";
import type { DesignToolRead } from "./index";
import { inexact } from "./ir";

// Reported through the unresolved-images notice, which offers to fill them.
const UNRESOLVED_IMAGE_WARNING =
  /could not be loaded without a Figma access token/;
const WORKER_TIMEOUT_MS = 30_000;
// Checked before decoding: base64 expands the bytes by a third, and decoding
// allocates them all before the decoder's own cap applies.
const MAX_ENCODED_CHARS = Math.ceil(MAX_CLIPBOARD_BUFFER_BYTES / 3) * 4 + 8;

function wrapDocument(html: string): string {
  return /<html[\s>]/i.test(html)
    ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

/**
 * A scene can be megabytes of kiwi and tens of thousands of nodes, so decoding
 * runs in a worker and the paste handler never blocks. Without Worker support
 * (tests, SSR) it decodes inline.
 */
function decode(bytes: Uint8Array): Promise<DecodedFigmaClipboard> {
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() => decodeFigmaClipboardFrames(bytes));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./figma-paste.worker.ts", import.meta.url),
      { type: "module" },
    );
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      finish();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(new Error("decoding the Figma copy took too long")),
        ),
      WORKER_TIMEOUT_MS,
    );
    worker.onmessage = (event: MessageEvent<FigmaPasteWorkerResponse>) =>
      settle(() =>
        event.data.ok
          ? resolve(event.data.result)
          : reject(new Error(event.data.error)),
      );
    worker.onerror = (event) => {
      event.preventDefault();
      settle(() =>
        reject(new Error(event.message || "the paste worker failed")),
      );
    };
    worker.onmessageerror = () =>
      settle(() =>
        reject(new Error("the paste worker sent an unreadable result")),
      );
    worker.postMessage({ bytes }, [bytes.buffer]);
  });
}

export function detectFigma(html: string): boolean {
  return hasFigmaClipboardMarkers(html);
}

/** Figma's clipboard carries the whole scene as a `fig-kiwi` buffer. */
export async function readFigma(html: string): Promise<DesignToolRead> {
  const base64 = extractFigmaBuffer(html);
  if (!base64) {
    return { status: "invalid", tool: "figma", reason: "no scene buffer" };
  }
  if (base64.length > MAX_ENCODED_CHARS) {
    return {
      status: "invalid",
      tool: "figma",
      reason: "the copy is larger than the paste limit",
    };
  }
  try {
    const decoded = await decode(base64ToBytes(base64));
    return {
      status: "ok",
      tool: "figma",
      layers: decoded.frames.map((frame) => ({
        title: frame.frameName,
        width: frame.width ?? null,
        height: frame.height ?? null,
        content: wrapDocument(frame.html),
        wrapsLooseNode: frame.wrapsLooseNode,
        origin: { x: frame.x, y: frame.y },
        sourceOffset: frame.sourceOffset,
      })),
      warnings: decoded.warnings
        .filter((warning) => !UNRESOLVED_IMAGE_WARNING.test(warning))
        .map(inexact),
      unresolvedImages: decoded.unresolvedImageRefs.length,
    };
  } catch (error) {
    return {
      status: "invalid",
      tool: "figma",
      reason: error instanceof Error ? error.message : "decode failed",
    };
  }
}
