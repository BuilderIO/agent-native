import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";

import { runtimeSrcSpans } from "../design-canvas/runtime-src-spans";
import type {
  PreviewParseRequest,
  PreviewParseResponse,
} from "./preview-parse.worker";

// Building a static preview's srcdoc parses its whole screen, which stalls the
// page on large screens; workers parse ahead of mount, nearest screens first.
const MAX_PREVIEW_PARSE_WORKERS = 3;
type ColorCountsResolve = (counts: Map<string, number> | null) => void;
let workers: Worker[] | null | undefined;
// One job per worker: a posted message cannot be withdrawn, so a fast pan
// would bury the screens now in view behind ones that scrolled away.
let idleWorkers: Worker[] = [];
let nextRequestId = 0;
let requestedPreviews: string[] = [];
let wantedPreviews: string[] = [];
let queuedPreviews = new Set<string>();
const inFlightPreviews = new Map<number, string>();
const queuedColorCounts = new Map<
  string,
  { content: string; resolve: ColorCountsResolve }
>();
const inFlightColorCounts = new Map<number, ColorCountsResolve>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function isParsed(content: string): boolean {
  return (
    createSourceDocumentProvenance.has(content) && runtimeSrcSpans.has(content)
  );
}

function isInFlight(content: string): boolean {
  for (const inFlight of inFlightPreviews.values()) {
    if (inFlight === content) return true;
  }
  return false;
}

function stopWorkers() {
  workers?.forEach((worker) => worker.terminate());
  workers = null;
  idleWorkers = [];
  requestedPreviews = [];
  wantedPreviews = [];
  queuedPreviews = new Set();
  inFlightPreviews.clear();
  queuedColorCounts.forEach(({ resolve }) => resolve(null));
  queuedColorCounts.clear();
  inFlightColorCounts.forEach((resolve) => resolve(null));
  inFlightColorCounts.clear();
  notify();
}

function nextJob(): PreviewParseRequest | null {
  while (requestedPreviews.length > 0 || wantedPreviews.length > 0) {
    const content = requestedPreviews.shift() ?? wantedPreviews.shift()!;
    if (isParsed(content) || isInFlight(content)) continue;
    const id = nextRequestId++;
    inFlightPreviews.set(id, content);
    return { kind: "preview", id, content };
  }
  const [fileId, job] = queuedColorCounts.entries().next().value ?? [];
  if (!fileId || !job) return null;
  queuedColorCounts.delete(fileId);
  const id = nextRequestId++;
  inFlightColorCounts.set(id, job.resolve);
  return { kind: "colors", id, fileId, content: job.content };
}

function dispatch() {
  while (idleWorkers.length > 0) {
    const job = nextJob();
    if (!job) break;
    idleWorkers.shift()!.postMessage(job);
  }
  queuedPreviews = new Set([...requestedPreviews, ...wantedPreviews]);
}

function receive(worker: Worker, event: MessageEvent<PreviewParseResponse>) {
  const response = event.data;
  idleWorkers.push(worker);
  if (response.kind === "colors") {
    const resolve = inFlightColorCounts.get(response.id);
    inFlightColorCounts.delete(response.id);
    resolve?.(new Map(response.counts));
  } else {
    const content = inFlightPreviews.get(response.id);
    inFlightPreviews.delete(response.id);
    if (content !== undefined) {
      createSourceDocumentProvenance.prime(content, response.provenance);
      runtimeSrcSpans.prime(content, response.runtimeSpans);
    }
  }
  dispatch();
  if (response.kind === "preview") notify();
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
    worker.onmessage = (event) => receive(worker, event);
    // Previews then parse on the main thread; nothing may wait on a result
    // that will never arrive.
    worker.onerror = (event) => {
      event.preventDefault();
      stopWorkers();
    };
    worker.onmessageerror = stopWorkers;
    return worker;
  });
  idleWorkers = [...workers];
  return workers;
}

/** Parses these screens ahead of everything the canvas wants; never dropped. */
export function requestPreviewParses(contents: readonly string[]): void {
  if (!previewParseWorkers()) return;
  for (const content of contents) {
    if (isParsed(content) || isPreviewParsePending(content)) continue;
    requestedPreviews.push(content);
  }
  dispatch();
}

/**
 * The screens the canvas is about to mount, nearest first. Replaces the last
 * list, so a queued screen that is no longer wanted is never parsed.
 */
export function wantPreviewParses(contents: readonly string[]): void {
  if (!previewParseWorkers()) return;
  wantedPreviews = [...new Set(contents)].filter(
    (content) =>
      !isParsed(content) &&
      !isInFlight(content) &&
      !requestedPreviews.includes(content),
  );
  dispatch();
}

/**
 * Each content's document color counts, or null where no worker answered. A
 * newer request for the same screen answers a still-queued older one with null.
 */
export function requestDocumentColorCounts(
  files: readonly { id: string; content: string }[],
): Promise<(Map<string, number> | null)[]> {
  if (!previewParseWorkers()) return Promise.resolve(files.map(() => null));
  const counted = Promise.all(
    files.map(
      (file) =>
        new Promise<Map<string, number> | null>((resolve) => {
          queuedColorCounts.get(file.id)?.resolve(null);
          queuedColorCounts.delete(file.id);
          queuedColorCounts.set(file.id, { content: file.content, resolve });
        }),
    ),
  );
  dispatch();
  return counted;
}

export function isPreviewParsePending(content: string): boolean {
  return queuedPreviews.has(content) || isInFlight(content);
}

export function subscribePreviewParses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
