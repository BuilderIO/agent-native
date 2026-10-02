import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";

import { runtimeSrcSpans } from "../design-canvas/runtime-src-spans";
import type {
  PreviewParseRequest,
  PreviewParseResponse,
} from "./preview-parse.worker";

// Building a static preview's srcdoc parses its whole screen, which stalls the
// page on large screens; workers parse ahead of mount, nearest screens first.
const MAX_PREVIEW_PARSE_WORKERS = 3;
let workers: Worker[] | null | undefined;
let nextWorker = 0;
let nextRequestId = 0;
const pendingContentById = new Map<number, string>();
const pendingContents = new Set<string>();
const pendingColorCountsById = new Map<
  number,
  (counts: Map<string, number> | null) => void
>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function stopWorkers() {
  workers?.forEach((worker) => worker.terminate());
  workers = null;
  pendingContentById.clear();
  pendingContents.clear();
  pendingColorCountsById.forEach((resolve) => resolve(null));
  pendingColorCountsById.clear();
  notify();
}

function receive(event: MessageEvent<PreviewParseResponse>) {
  const response = event.data;
  if (response.kind === "colors") {
    const resolve = pendingColorCountsById.get(response.id);
    pendingColorCountsById.delete(response.id);
    resolve?.(new Map(response.counts));
    return;
  }
  const content = pendingContentById.get(response.id);
  if (content === undefined) return;
  pendingContentById.delete(response.id);
  pendingContents.delete(content);
  createSourceDocumentProvenance.prime(content, response.provenance);
  runtimeSrcSpans.prime(content, response.runtimeSpans);
  notify();
}

function postToPool(pool: Worker[], request: PreviewParseRequest) {
  pool[nextWorker % pool.length]!.postMessage(request);
  nextWorker += 1;
}

function previewParseWorkers(): Worker[] | null {
  if (workers !== undefined) return workers;
  if (typeof Worker === "undefined") {
    workers = null;
    return workers;
  }
  const count = Math.max(
    1,
    Math.min(
      MAX_PREVIEW_PARSE_WORKERS,
      (navigator.hardwareConcurrency || 2) - 1,
    ),
  );
  workers = Array.from({ length: count }, () => {
    const worker = new Worker(
      new URL("./preview-parse.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = receive;
    // Previews then parse on the main thread; nothing may wait on a result
    // that will never arrive.
    worker.onerror = (event) => {
      event.preventDefault();
      stopWorkers();
    };
    worker.onmessageerror = stopWorkers;
    return worker;
  });
  return workers;
}

export function requestPreviewParses(contents: readonly string[]): void {
  const pool = previewParseWorkers();
  if (!pool) return;
  for (const content of contents) {
    if (
      pendingContents.has(content) ||
      (createSourceDocumentProvenance.has(content) &&
        runtimeSrcSpans.has(content))
    ) {
      continue;
    }
    const id = nextRequestId;
    nextRequestId += 1;
    pendingContentById.set(id, content);
    pendingContents.add(content);
    postToPool(pool, { kind: "preview", id, content });
  }
}

/** Each content's document color counts, or null where no worker answered. */
export function requestDocumentColorCounts(
  files: readonly { id: string; content: string }[],
): Promise<(Map<string, number> | null)[]> {
  const pool = previewParseWorkers();
  if (!pool) return Promise.resolve(files.map(() => null));
  return Promise.all(
    files.map(
      (file) =>
        new Promise<Map<string, number> | null>((resolve) => {
          const id = nextRequestId;
          nextRequestId += 1;
          pendingColorCountsById.set(id, resolve);
          postToPool(pool, {
            kind: "colors",
            id,
            fileId: file.id,
            content: file.content,
          });
        }),
    ),
  );
}

export function isPreviewParsePending(content: string): boolean {
  return pendingContents.has(content);
}

export function subscribePreviewParses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
