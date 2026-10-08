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

const reply = (worker: FakeWorker, request: PreviewParseRequest) =>
  worker.onmessage!({
    data:
      request.kind === "colors"
        ? { kind: "colors", id: request.id, counts: [] }
        : {
            kind: "preview",
            id: request.id,
            provenance: { versionHash: "", uniqueNodeIds: [] },
            runtimeSpans: [],
          },
  } as MessageEvent);

it("gives each worker one parse at a time and drops screens the canvas stopped wanting", async () => {
  const warmer = await loadWarmer();
  const screens = Array.from(
    { length: FakeWorker.instances.length + 8 },
    (_, index) => `<p>${index}</p>`,
  );
  warmer.wantPreviewParses(screens.slice(0, 6));
  const pool = FakeWorker.instances;
  expect(pool.every((worker) => worker.posted.length === 1)).toBe(true);
  const queued = screens.slice(pool.length, 6);
  expect(queued.every(warmer.isPreviewParsePending)).toBe(true);

  warmer.wantPreviewParses([screens[7]!]);
  expect(queued.some(warmer.isPreviewParsePending)).toBe(false);

  reply(pool[0]!, pool[0]!.posted[0]!);
  expect(pool[0]!.posted[pool[0]!.posted.length - 1]).toMatchObject({
    content: screens[7],
  });
});

it("keeps only a screen's newest queued color count", async () => {
  const warmer = await loadWarmer();
  warmer.wantPreviewParses(
    Array.from({ length: 8 }, (_, index) => `<p>${index}</p>`),
  );
  const pool = FakeWorker.instances;
  const stale = warmer.requestDocumentColorCounts([
    { id: "screen-1", content: "<p>old</p>" },
  ]);
  const fresh = warmer.requestDocumentColorCounts([
    { id: "screen-1", content: "<p>new</p>" },
  ]);
  expect(await stale).toEqual([null]);

  warmer.wantPreviewParses([]);
  for (const worker of pool) reply(worker, worker.posted[0]!);
  const colorJobs = pool.flatMap((worker) =>
    worker.posted.filter((request) => request.kind === "colors"),
  );
  expect(colorJobs).toEqual([
    expect.objectContaining({ fileId: "screen-1", content: "<p>new</p>" }),
  ]);
  const owner = pool.find((worker) => worker.posted.includes(colorJobs[0]!))!;
  reply(owner, colorJobs[0]!);
  expect(await fresh).toEqual([new Map()]);
});
