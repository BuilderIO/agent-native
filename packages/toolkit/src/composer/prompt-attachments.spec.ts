// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  escapePromptAttachmentAttribute,
  formatPromptWithAttachments,
  isInlineableAgentPromptFile,
  readAgentPromptAttachment,
} from "./prompt-attachments.js";

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
      width: 4096,
      height: 3072,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
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

    const file = new File([new Uint8Array(6 * 1024 * 1024)], "reference.png", {
      type: "image/png",
    });
    expect(file.size).toBe(6 * 1024 * 1024);
    const attachment = await readAgentPromptAttachment(file, {
      maxInlineImageBytes: 2,
    });

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(attachment.size).toBe(file.size);
    expect(attachment.type).toBe("image/jpeg");
    expect(attachment.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.9,
    );
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
