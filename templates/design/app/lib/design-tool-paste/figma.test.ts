import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const decode = vi.fn();
vi.mock("@shared/figma-clipboard-decode", () => ({
  MAX_CLIPBOARD_BUFFER_BYTES: 8 * 1024 * 1024,
  decodeFigmaClipboardFrames: (bytes: Uint8Array) => decode(bytes),
}));

import { readDesignToolPasteHtml } from "./index";

const CLIPBOARD =
  '<meta charset="utf-8"><!--(figmeta)ZXhhbXBsZQ==(/figmeta)--><!--(figma)ZXhhbXBsZQ==(/figma)-->';

const frame = (html: string) => ({
  html,
  fileName: "card.html",
  frameName: "Card",
  width: 320,
  height: 200,
  x: 40,
  y: 60,
  wrapsLooseNode: true,
  sourceOffset: { x: 4, y: 6 },
});

beforeEach(() => {
  decode.mockReset();
});

describe("Figma clipboard", () => {
  it("decodes the scene buffer into placed layers without a server call", async () => {
    decode.mockReturnValue({
      frames: [frame("<div>hi</div>")],
      warnings: ["Gradient approximated"],
      unresolvedImageRefs: [],
    });
    const read = await readDesignToolPasteHtml(CLIPBOARD);
    expect(read).toMatchObject({
      status: "ok",
      tool: "figma",
      warnings: [{ kind: "inexact", detail: "Gradient approximated" }],
      unresolvedImages: 0,
    });
    if (read.status !== "ok") return;
    expect(read.layers[0]).toMatchObject({
      title: "Card",
      width: 320,
      height: 200,
      wrapsLooseNode: true,
      origin: { x: 40, y: 60 },
      sourceOffset: { x: 4, y: 6 },
    });
    expect(read.layers[0]?.content).toMatch(/^<!DOCTYPE html>/);
    expect(decode.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
  });

  it("keeps a full document as it is", async () => {
    const doc = "<!doctype html><html><head></head><body>x</body></html>";
    decode.mockReturnValue({
      frames: [frame(doc)],
      warnings: [],
      unresolvedImageRefs: [],
    });
    const read = await readDesignToolPasteHtml(CLIPBOARD);
    expect(read.status === "ok" && read.layers[0]?.content).toBe(doc);
  });

  it("hands unloaded images to the notice instead of a warning", async () => {
    decode.mockReturnValue({
      frames: [frame("<div></div>")],
      warnings: [
        "2 images could not be loaded without a Figma access token. Connect Figma to fill them in.",
      ],
      unresolvedImageRefs: ["a", "b"],
    });
    const read = await readDesignToolPasteHtml(CLIPBOARD);
    expect(read).toMatchObject({
      status: "ok",
      unresolvedImages: 2,
      warnings: [],
    });
  });

  it("says why a copy it cannot decode failed, not that it was absent", async () => {
    decode.mockImplementation(() => {
      throw new Error("Figma clipboard has too many nodes");
    });
    expect(await readDesignToolPasteHtml(CLIPBOARD)).toEqual({
      status: "invalid",
      tool: "figma",
      reason: "Figma clipboard has too many nodes",
    });
  });

  it("refuses an oversized buffer before decoding it", async () => {
    const huge = "A".repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 16);
    const read = await readDesignToolPasteHtml(
      `<!--(figmeta)ZXhhbXBsZQ==(/figmeta)--><!--(figma)${huge}(/figma)-->`,
    );
    expect(read).toEqual({
      status: "invalid",
      tool: "figma",
      reason: "the copy is larger than the paste limit",
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it("reports a copy with metadata but no scene buffer as invalid", async () => {
    expect(
      await readDesignToolPasteHtml("<!--(figmeta)ZXhhbXBsZQ==(/figmeta)-->"),
    ).toEqual({ status: "invalid", tool: "figma", reason: "no scene buffer" });
  });
});

describe("Figma clipboard decoding off the main thread", () => {
  class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror:
      | ((event: { message: string; preventDefault(): void }) => void)
      | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    posted: { message: unknown; transfer: unknown } | null = null;
    constructor() {
      FakeWorker.last = this;
    }
    postMessage(message: unknown, transfer: unknown) {
      this.posted = { message, transfer };
    }
    terminate() {
      this.terminated = true;
    }
  }

  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.last = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the bytes to a worker without decoding on this thread", async () => {
    const pending = readDesignToolPasteHtml(CLIPBOARD);
    const worker = FakeWorker.last;
    expect(decode).not.toHaveBeenCalled();
    expect(worker?.posted?.transfer).toHaveLength(1);
    worker?.onmessage?.({
      data: {
        ok: true,
        result: {
          frames: [frame("<div></div>")],
          warnings: [],
          unresolvedImageRefs: [],
        },
      },
    });
    expect(await pending).toMatchObject({ status: "ok", tool: "figma" });
    expect(worker?.terminated).toBe(true);
  });

  it("reports the worker's error as invalid and stops the worker", async () => {
    const pending = readDesignToolPasteHtml(CLIPBOARD);
    const worker = FakeWorker.last;
    worker?.onmessage?.({
      data: { ok: false, error: "Figma clipboard has too many nodes" },
    });
    expect(await pending).toEqual({
      status: "invalid",
      tool: "figma",
      reason: "Figma clipboard has too many nodes",
    });
    expect(worker?.terminated).toBe(true);
  });

  it("reports a crashed worker instead of hanging", async () => {
    const pending = readDesignToolPasteHtml(CLIPBOARD);
    FakeWorker.last?.onerror?.({ message: "boom", preventDefault: () => {} });
    expect(await pending).toMatchObject({
      status: "invalid",
      tool: "figma",
      reason: "boom",
    });
    expect(FakeWorker.last?.terminated).toBe(true);
  });

  it("gives up on a worker that never answers", async () => {
    vi.useFakeTimers();
    try {
      const pending = readDesignToolPasteHtml(CLIPBOARD);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toMatchObject({
        status: "invalid",
        reason: "decoding the Figma copy took too long",
      });
      expect(FakeWorker.last?.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
