// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { preparePromptImageAttachment } from "./prompt-image-optimization";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalImage = globalThis.Image;

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value: originalToBlob,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: originalGetContext,
  });
  vi.stubGlobal("Image", originalImage);
});

describe("preparePromptImageAttachment", () => {
  it("keeps small images unchanged when their visual payload fits", async () => {
    const file = new File(["small image"], "reference.png", {
      type: "image/png",
    });

    const prepared = await preparePromptImageAttachment(file, 1_000);

    expect(prepared?.file).toBe(file);
    expect(prepared?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("downscales large images into a bounded upload file before encoding", async () => {
    const createObjectURL = vi.fn(() => "blob:source-image");
    const revokeObjectURL = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string) =>
      callback(new Blob([new Uint8Array(512)], { type })),
    );
    const drawImage = vi.fn();
    let renderedCanvas: HTMLCanvasElement | undefined;

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: toBlob,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function () {
        renderedCanvas = this as HTMLCanvasElement;
        return { drawImage };
      },
    });
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 3000;
        naturalHeight = 2000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    const file = new File([new Uint8Array(5 * 1024 * 1024)], "reference.png", {
      type: "image/png",
    });
    const prepared = await preparePromptImageAttachment(file, 2_000);

    expect(prepared).not.toBeNull();
    expect(prepared?.file).not.toBe(file);
    expect(prepared?.file.name).toBe("reference.webp");
    expect(prepared?.file.type).toBe("image/webp");
    expect(prepared?.file.size).toBeLessThan(file.size);
    expect(prepared?.dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(renderedCanvas?.width).toBe(1400);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source-image");
  });
});
