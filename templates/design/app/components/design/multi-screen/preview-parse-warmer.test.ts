import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PreviewParseRequest } from "./preview-parse.worker";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: PreviewParseRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: PreviewParseRequest) {
    this.posted.push(request);
  }
  terminate() {
    this.terminated = true;
  }
}

async function loadWarmer() {
  vi.resetModules();
  const warmer = await import("./preview-parse-warmer");
  const { createSourceDocumentProvenance } =
    await import("@shared/preview-source-provenance");
  const { runtimeSrcSpans } =
    await import("../design-canvas/runtime-src-spans");
  return { ...warmer, createSourceDocumentProvenance, runtimeSrcSpans };
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("holds a screen as pending until the worker answers, then serves the worker's parses", async () => {
  const warmer = await loadWarmer();
  const listener = vi.fn();
  warmer.subscribePreviewParses(listener);

  warmer.requestPreviewParses(["<p>a</p>"]);
  warmer.requestPreviewParses(["<p>a</p>"]);
  const [worker] = FakeWorker.instances;
  expect(worker!.posted).toHaveLength(1);
  expect(warmer.isPreviewParsePending("<p>a</p>")).toBe(true);

  const provenance = { versionHash: "from-worker", uniqueNodeIds: ["x"] };
  const runtimeSpans = [{ start: 1, end: 2, runtime: "alpine" as const }];
  worker!.onmessage!({
    data: {
      kind: "preview",
      id: worker!.posted[0]!.id,
      provenance,
      runtimeSpans,
    },
  } as MessageEvent);

  expect(listener).toHaveBeenCalledTimes(1);
  expect(warmer.isPreviewParsePending("<p>a</p>")).toBe(false);
  expect(warmer.createSourceDocumentProvenance("<p>a</p>")).toBe(provenance);
  expect(warmer.runtimeSrcSpans("<p>a</p>")).toBe(runtimeSpans);
});

it("releases every pending screen when the worker fails", async () => {
  const warmer = await loadWarmer();
  warmer.requestPreviewParses(["<p>a</p>", "<p>b</p>"]);
  const [worker] = FakeWorker.instances;

  worker!.onerror!({ preventDefault() {} });

  expect(FakeWorker.instances.every((each) => each.terminated)).toBe(true);
  expect(warmer.isPreviewParsePending("<p>a</p>")).toBe(false);
  expect(warmer.isPreviewParsePending("<p>b</p>")).toBe(false);
  const started = FakeWorker.instances.length;
  warmer.requestPreviewParses(["<p>c</p>"]);
  expect(FakeWorker.instances).toHaveLength(started);
  expect(warmer.isPreviewParsePending("<p>c</p>")).toBe(false);
});

it("counts document colors in a worker, keyed by the screen", async () => {
  const warmer = await loadWarmer();
  const counted = warmer.requestDocumentColorCounts([
    { id: "screen-1", content: "<p style='color:#fff'>a</p>" },
  ]);
  const [worker] = FakeWorker.instances;
  const [request] = worker!.posted;
  expect(request).toMatchObject({ kind: "colors", fileId: "screen-1" });

  worker!.onmessage!({
    data: { kind: "colors", id: request!.id, counts: [["#ffffff", 1]] },
  } as MessageEvent);

  expect(await counted).toEqual([new Map([["#ffffff", 1]])]);
});

it("answers color counts with null when the worker fails", async () => {
  const warmer = await loadWarmer();
  const counted = warmer.requestDocumentColorCounts([
    { id: "screen-1", content: "<p>a</p>" },
  ]);
  FakeWorker.instances[0]!.onerror!({ preventDefault() {} });

  expect(await counted).toEqual([null]);
});
