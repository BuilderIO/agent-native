// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  escapePromptAttachmentAttribute,
  formatPromptWithAttachments,
  isInlineableAgentPromptFile,
  readAgentPromptAttachment,
} from "./prompt-attachments.js";

function pngBytes(width: number, height: number, byteLength = 24): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("prompt attachment helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("inlines readable text files up to the configured limit", async () => {
    const file = new File(["hello"], "notes.md", {
      type: "text/markdown",
    });

    const attachment = await readAgentPromptAttachment(file);

    expect(isInlineableAgentPromptFile(file)).toBe(true);
    expect(attachment).toEqual({
      name: "notes.md",
      type: "text/markdown",
      size: 5,
      text: "hello",
    });
  });

  it("falls back to filename metadata for oversized text files", async () => {
    const file = new File(["hello"], "notes.md", {
      type: "text/markdown",
    });

    const attachment = await readAgentPromptAttachment(file, {
      maxInlineTextChars: 2,
    });

    expect(attachment).toEqual({
      name: "notes.md",
      type: "text/markdown",
      size: 5,
    });
  });

  it("inlines small image files as data URLs", async () => {
    const file = new File(["fake image"], "screenshot.png", {
      type: "image/png",
    });

    const attachment = await readAgentPromptAttachment(file);

    expect(attachment.name).toBe("screenshot.png");
    expect(attachment.type).toBe("image/png");
    expect(attachment.dataUrl).toContain("data:image/png;base64,");
  });

  it("shrinks oversized raster images and falls back to JPEG within the budget", async () => {
    const bitmap = {
      width: 2048,
      height: 1536,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createBitmap = vi
      .fn()
      .mockResolvedValue(bitmap) as typeof createImageBitmap;
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback, type) => {
        const blob = new Blob(["x".repeat(type === "image/png" ? 3 : 1)], {
          type,
        });
        callback(blob);
      });

    const file = new File(
      [pngBytes(4096, 3072, 6 * 1024 * 1024)],
      "reference.png",
      { type: "image/png" },
    );
    expect(file.size).toBe(6 * 1024 * 1024);
    const attachment = await readAgentPromptAttachment(file, {
      maxInlineImageBytes: 2,
    });

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(createBitmap).toHaveBeenCalledWith(file, {
      resizeWidth: 2048,
      resizeHeight: 1536,
      resizeQuality: "high",
    });
    expect(attachment.size).toBe(file.size);
    expect(attachment.type).toBe("image/jpeg");
    expect(attachment.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.9,
    );
  });

  it("skips decoding when the file or pixel dimensions exceed the resize budget", async () => {
    const createBitmap = vi.fn() as typeof createImageBitmap;
    vi.stubGlobal("createImageBitmap", createBitmap);

    const pathologicalPixels = new File(
      [pngBytes(100_000, 100_000, 6 * 1024 * 1024)],
      "huge-dimensions.png",
      { type: "image/png" },
    );
    const largeFile = new File(
      [pngBytes(4096, 3072, 25 * 1024 * 1024 + 1)],
      "huge-file.png",
      { type: "image/png" },
    );

    for (const file of [pathologicalPixels, largeFile]) {
      const attachment = await readAgentPromptAttachment(file);
      expect(attachment.dataUrl).toBeUndefined();
    }
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("reads JPEG dimensions before asking the browser to decode a large image", async () => {
    const bitmap = {
      width: 2048,
      height: 1536,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createBitmap = vi
      .fn()
      .mockResolvedValue(bitmap) as typeof createImageBitmap;
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["x"], { type: "image/png" })),
    );

    const bytes = new Uint8Array(6 * 1024 * 1024);
    bytes.set([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0c, 0x00, 0x10, 0x00,
    ]);
    const file = new File([bytes], "reference.jpg", { type: "image/jpeg" });

    await readAgentPromptAttachment(file);

    expect(createBitmap).toHaveBeenCalledWith(file, {
      resizeWidth: 2048,
      resizeHeight: 1536,
      resizeQuality: "high",
    });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("formats attachments with escaped XML attributes", () => {
    const formatted = formatPromptWithAttachments("Review this", [
      {
        name: 'bad"name&.ts',
        type: "text/plain",
        size: 12,
        text: "const x = 1;",
      },
      {
        name: "shot.png",
        type: "image/png",
        size: 3,
        dataUrl: "data:image/png;base64,abc",
      },
    ]);

    expect(escapePromptAttachmentAttribute('a&"b')).toBe("a&amp;&quot;b");
    expect(formatted).toContain("Attached context:");
    expect(formatted).toContain('name="bad&quot;name&amp;.ts"');
    expect(formatted).toContain("<attached-file");
    expect(formatted).toContain("<attached-image");
    expect(formatted).toContain("data:image/png;base64,abc");
  });
});
