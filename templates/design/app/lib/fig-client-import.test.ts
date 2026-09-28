import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderedFigImport } from "../../shared/fig-to-frames.js";

const mocks = vi.hoisted(() => ({
  assertEmbeddedImageBudget: vi.fn(),
  callAction: vi.fn(),
  decodeFig: vi.fn(),
  inspectDecodedFig: vi.fn(),
  renderFigImport: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  getBrowserTabId: () => "tab-1",
}));
vi.mock("../../server/lib/fig-file-decoder.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decodeFig: mocks.decodeFig,
}));
vi.mock("../../shared/fig-to-frames.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertEmbeddedImageBudget: mocks.assertEmbeddedImageBudget,
  inspectDecodedFig: mocks.inspectDecodedFig,
  renderFigImport: mocks.renderFigImport,
}));

import {
  FigClientImportError,
  importFigInBrowser,
  MAX_CLIENT_FIG_BYTES,
  MAX_CLIENT_IMAGE_BYTES,
  prepareFigImport,
} from "./fig-client-import";

const file = {
  name: "large.fig",
  size: 0,
  arrayBuffer: async () => new ArrayBuffer(0),
} as unknown as File;

const PLACEHOLDER_PREFIX = "https://fig-image.invalid/test/";

function decoded(images: Array<{ hash?: string; bytes: Uint8Array }> = []) {
  return {
    format: "kiwi" as const,
    version: 124,
    document: { nodeChanges: [] },
    images,
    thumbnail: null,
  };
}

function rendered(
  frames: Array<Partial<RenderedFigImport["frames"][number]>> = [],
  images: RenderedFigImport["images"] = [],
): RenderedFigImport {
  return {
    format: "kiwi",
    version: 124,
    pageCount: 1,
    nodeCount: 0,
    imageCount: images.length,
    approximatedNodeCount: 0,
    unresolvedImageRefCount: 0,
    imagePlaceholderPrefix: PLACEHOLDER_PREFIX,
    images,
    frames: frames.map((frame, index) => {
      const html = frame.html ?? `<main>${index}</main>`;
      return {
        html,
        htmlBytes: new TextEncoder().encode(html).length,
        filename: `Page-frame-${index}.html`,
        pageName: "Page",
        frameName: `Frame ${index}`,
        width: 100,
        height: 50,
        ...frame,
      };
    }),
  };
}

function importCalls() {
  return mocks.callAction.mock.calls.filter(
    ([name]) => name === "import-design-source",
  );
}

function acceptFrames(input: { frames: Array<{ clientImportId: string }> }) {
  return {
    designId: "design-1",
    files: input.frames.map((frame) => ({
      id: `file-${frame.clientImportId}`,
      filename: "frame.html",
    })),
  };
}

describe("importFigInBrowser", () => {
  beforeEach(() => {
    mocks.assertEmbeddedImageBudget.mockReset();
    mocks.callAction.mockReset();
    mocks.decodeFig.mockReset().mockReturnValue(decoded());
    mocks.inspectDecodedFig.mockReset().mockReturnValue({
      pageCount: 1,
      frameCount: 0,
      nodeCount: 0,
      imageCount: 0,
      frames: [],
    });
    mocks.renderFigImport.mockReset().mockReturnValue(rendered());
  });

  it("keeps oversized embedded images out of the render and reports them", async () => {
    mocks.decodeFig.mockReturnValue(
      decoded([
        { bytes: new Uint8Array(MAX_CLIENT_IMAGE_BYTES) },
        { bytes: new Uint8Array(MAX_CLIENT_IMAGE_BYTES + 1) },
      ]),
    );

    const result = await importFigInBrowser({ designId: "design-1", file });

    expect(mocks.renderFigImport.mock.calls[0]![0].images).toHaveLength(1);
    expect(mocks.renderFigImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxFrameHtmlBytes: 2 * 1024 * 1024 }),
    );
    expect(result.skippedEmbeddedImageCount).toBe(1);
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("rejects a file above the browser allocation ceiling before reading it", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const oversizedFile = {
      name: "too-large.fig",
      size: MAX_CLIENT_FIG_BYTES + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(
      importFigInBrowser({ designId: "design-1", file: oversizedFile }),
    ).rejects.toThrow(/512 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mocks.decodeFig).not.toHaveBeenCalled();
  });

  it("checks the full embedded-image budget before transport filtering", async () => {
    const images = [{ bytes: new Uint8Array(1) }];
    mocks.decodeFig.mockReturnValue(decoded(images));
    mocks.assertEmbeddedImageBudget.mockImplementation(() => {
      throw new Error(".fig document has too much embedded image data");
    });

    await expect(
      importFigInBrowser({ designId: "design-1", file }),
    ).rejects.toThrow(/too much embedded image data/);
    expect(mocks.assertEmbeddedImageBudget).toHaveBeenCalledWith(images);
    expect(mocks.renderFigImport).not.toHaveBeenCalled();
  });

  it("renders a prepared import's selection and frees it afterwards", async () => {
    const prepared = await prepareFigImport(file);
    const dispose = vi.spyOn(prepared, "dispose");
    const selection = new Set(["frame-1"]);

    await importFigInBrowser({
      designId: "design-1",
      file,
      prepared,
      selection,
    });

    expect(mocks.decodeFig).toHaveBeenCalledTimes(1);
    expect(mocks.renderFigImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ selection }),
    );
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("uploads referenced images and swaps their URLs into the frames", async () => {
    const placeholder = `${PLACEHOLDER_PREFIX}0.img`;
    mocks.renderFigImport.mockReturnValue(
      rendered(
        [
          {
            html: `<div style="background-image: url('${placeholder}')"></div>`,
          },
        ],
        [
          {
            hash: "abc",
            ext: "png",
            bytes: new Uint8Array([1, 2, 3]),
            placeholder,
          },
        ],
      ),
    );
    mocks.callAction.mockImplementation(async (action: string, input) => {
      if (action === "upload-image" && input.data) {
        return { url: "https://assets.example.com/a.png?x=1&y=2" };
      }
      if (action === "upload-image") return { released: true };
      return acceptFrames(input);
    });

    await importFigInBrowser({ designId: "design-1", file });

    expect(mocks.callAction).toHaveBeenCalledWith(
      "upload-image",
      expect.objectContaining({ data: "data:image/png;base64,AQID" }),
      { headers: { "X-Request-Source": "tab-1" } },
    );
    expect(importCalls()[0]![1].frames[0].content).toBe(
      `<div style="background-image: url('https://assets.example.com/a.png?x=1&amp;y=2')"></div>`,
    );
  });

  it("saves frames in batches of at most 32 with their relative positions", async () => {
    mocks.renderFigImport.mockReturnValue(
      rendered(
        Array.from({ length: 40 }, (_, index) => ({
          x: 1_000 + index * 200,
          y: index % 2 === 0 ? -300 : -100,
        })),
      ),
    );
    mocks.callAction.mockImplementation(async (_action: string, input) =>
      acceptFrames(input),
    );
    const progress = vi.fn();

    const result = await importFigInBrowser({
      designId: "design-1",
      file,
      onProgress: progress,
    });

    const calls = importCalls();
    expect(calls.map(([, input]) => input.frames.length)).toEqual([32, 8]);
    expect(calls.map(([, input]) => input.clientImportFinalBatch)).toEqual([
      false,
      true,
    ]);
    const [, first, options] = calls[0]!;
    expect(options).toEqual({ headers: { "X-Request-Source": "tab-1" } });
    expect(first.frames[0]).toMatchObject({
      frameX: 0,
      frameY: 0,
      frameTitle: "Frame 0",
      clientImportId: `${first.clientImportBatchId}:frame:0`,
    });
    expect(first.frames[1]).toMatchObject({ frameX: 200, frameY: 200 });
    expect(result.files).toHaveLength(40);
    expect(progress).toHaveBeenLastCalledWith({
      phase: "saving",
      ratio: 1,
      saved: 40,
      total: 40,
    });
  });

  it("leaves positions to the server when frames come from several pages", async () => {
    mocks.renderFigImport.mockReturnValue({
      ...rendered([
        { x: 0, y: 40, pageName: "Page 1" },
        { x: 0, y: 40, pageName: "Page 2" },
      ]),
      pageCount: 2,
    });
    mocks.callAction.mockImplementation(async (_action: string, input) =>
      acceptFrames(input),
    );

    await importFigInBrowser({ designId: "design-1", file });

    for (const frame of importCalls()[0]![1].frames) {
      expect(frame).not.toHaveProperty("frameX");
      expect(frame).not.toHaveProperty("frameY");
    }
  });

  it("starts a new batch before a request would pass the byte budget", async () => {
    const content = "x".repeat(1_200_000);
    mocks.renderFigImport.mockReturnValue(
      rendered(Array.from({ length: 5 }, () => ({ html: content }))),
    );
    mocks.callAction.mockImplementation(async (_action: string, input) =>
      acceptFrames(input),
    );

    await importFigInBrowser({ designId: "design-1", file });

    expect(importCalls().map(([, input]) => input.frames.length)).toEqual([
      2, 2, 1,
    ]);
  });

  it("retries a batch once with the same ids, then aborts the whole import", async () => {
    mocks.renderFigImport.mockReturnValue(
      rendered(Array.from({ length: 40 }, () => ({}))),
    );
    mocks.callAction.mockImplementation(async (_action: string, input) => {
      if (input.abort) return { deletedFileIds: ["file-1"] };
      if (importCalls().length === 1) return acceptFrames(input);
      throw new Error("second batch failed");
    });

    const result = importFigInBrowser({ designId: "design-1", file });

    await expect(result).rejects.toBeInstanceOf(FigClientImportError);
    await expect(result).rejects.toMatchObject({
      message: "second batch failed",
      remoteMutationStarted: true,
    });
    const calls = importCalls();
    expect(calls).toHaveLength(4);
    expect(calls[1]![1]).toEqual(calls[2]![1]);
    expect(calls[3]![1]).toEqual({
      designId: "design-1",
      sourceType: "fig-frame",
      clientImportBatchId: calls[0]![1].clientImportBatchId,
      abort: true,
    });
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "delete-file",
      expect.anything(),
      expect.anything(),
    );
  });

  it("says how many screens may remain when the abort fails too", async () => {
    mocks.renderFigImport.mockReturnValue(rendered([{}, {}]));
    mocks.callAction.mockRejectedValue(new Error("offline"));

    await expect(
      importFigInBrowser({ designId: "design-1", file }),
    ).rejects.toMatchObject({
      message: "offline Cleanup failed for 2 partially imported screens.",
      remoteMutationStarted: true,
    });
  });

  it("does not read an abort without deleted ids as a clean rollback", async () => {
    mocks.renderFigImport.mockReturnValue(rendered([{}]));
    mocks.callAction.mockImplementation(async (_action: string, input) =>
      input.abort ? { error: "abort unsupported" } : { error: "save failed" },
    );

    await expect(
      importFigInBrowser({ designId: "design-1", file }),
    ).rejects.toThrow(
      "save failed Cleanup failed for 1 partially imported screen.",
    );
  });

  it("rejects a batch the server only partly confirmed", async () => {
    mocks.renderFigImport.mockReturnValue(rendered([{}, {}]));
    mocks.callAction.mockImplementation(async (_action: string, input) =>
      input.abort
        ? { deletedFileIds: [] }
        : { designId: "design-1", files: [{ id: "file-1", filename: "a" }] },
    );

    await expect(
      importFigInBrowser({ designId: "design-1", file }),
    ).rejects.toThrow("The server confirmed 1 of 2 frames in a save batch.");
  });
});

describe("prepareFigImport in a Worker", () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posted: Array<{ id: number; type: string }> = [];
    terminate = vi.fn();
    constructor(
      readonly url: URL,
      readonly options: WorkerOptions,
    ) {
      FakeWorker.instances.push(this);
    }
    postMessage(message: { id: number; type: string }) {
      this.posted.push(message);
    }
  }

  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes in a module worker and keeps it until disposed", async () => {
    const summary = { frameCount: 1 };
    const pending = prepareFigImport(file);
    const worker = FakeWorker.instances[0]!;
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.posted[0]).toMatchObject({ type: "prepare", file });
    worker.onmessage!({
      data: { id: worker.posted[0]!.id, ok: true, result: summary },
    } as MessageEvent);

    const prepared = await pending;
    expect(prepared.summary).toBe(summary);
    expect(worker.terminate).not.toHaveBeenCalled();
    prepared.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(prepared.render()).rejects.toThrow(/cancelled/);
  });

  it("surfaces a worker crash as a failed prepare", async () => {
    const pending = prepareFigImport(file);
    const worker = FakeWorker.instances[0]!;
    worker.onerror!({
      message: "boom",
      preventDefault: () => {},
    } as ErrorEvent);

    await expect(pending).rejects.toThrow(
      "The .fig import worker failed: boom.",
    );
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("passes a worker-side error through with its message", async () => {
    const pending = prepareFigImport(file);
    const worker = FakeWorker.instances[0]!;
    worker.onmessage!({
      data: { id: worker.posted[0]!.id, ok: false, error: "bad .fig" },
    } as MessageEvent);

    await expect(pending).rejects.toThrow("bad .fig");
    expect(worker.terminate).toHaveBeenCalled();
  });
});
