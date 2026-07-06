import { beforeEach, describe, expect, it, vi } from "vitest";

const decodeMocks = vi.hoisted(() => ({
  decodeFig: vi.fn(),
}));

vi.mock("./decode.js", () => ({
  decodeFig: decodeMocks.decodeFig,
  isFigKiwiBuffer: (buffer: Buffer) =>
    buffer.subarray(0, 8).toString("utf8") === "fig-kiwi",
  isZipBuffer: (buffer: Buffer) => buffer[0] === 0x50 && buffer[1] === 0x4b,
}));

describe("importFigmaBuffer", () => {
  beforeEach(() => {
    decodeMocks.decodeFig.mockReset();
  });

  it("converts decoded frames into HTML files with inline images", async () => {
    decodeMocks.decodeFig.mockReturnValue({
      format: "kiwi",
      version: 1,
      document: {
        children: [
          {
            id: "1:1",
            type: "FRAME",
            name: "Home",
            width: 1440,
            height: 900,
            children: [
              {
                id: "1:2",
                type: "RECTANGLE",
                name: "Image",
                fills: [{ type: "IMAGE", imageRef: "hash" }],
              },
            ],
          },
        ],
      },
      images: [
        {
          hash: "hash",
          ext: "png",
          bytes: Buffer.from("fake image"),
        },
      ],
      thumbnail: null,
      blobs: [],
    });
    const { importFigmaBuffer } = await import("./processor.js");

    const result = await importFigmaBuffer({
      buffer: Buffer.concat([Buffer.from("fig-kiwi", "utf8"), Buffer.alloc(8)]),
      filename: "home.fig",
      sourceKind: "fig-file",
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.filename).toBe("home.html");
    expect(result.files[0]!.content).toContain("data:image/png;base64");
    expect(result.stats).toMatchObject({
      sourceKind: "fig-file",
      format: "kiwi",
      frameCount: 1,
      imageCount: 1,
    });
  });

  it("rejects unsupported buffers before decoding", async () => {
    const { importFigmaBuffer } = await import("./processor.js");

    await expect(
      importFigmaBuffer({
        buffer: Buffer.from("not fig"),
        filename: "bad.fig",
        sourceKind: "fig-file",
      }),
    ).rejects.toThrow(/not a supported/i);
  });
});
