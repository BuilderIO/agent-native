// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preparePromptImageAttachment,
  PromptImageOptimizationError,
} from "./prompt-image-optimization";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalImage = globalThis.Image;

function pngFile(
  name: string,
  { width = 3000, height = 2000, size = 64, animated = false } = {},
): File {
  const chunk = (type: string, dataLength: number) => {
    const bytes = new Uint8Array(dataLength + 12);
    new DataView(bytes.buffer).setUint32(0, dataLength);
    bytes.set(new TextEncoder().encode(type), 4);
    return bytes;
  };
  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = chunk("IHDR", 13);
  new DataView(ihdr.buffer).setUint32(8, width);
  new DataView(ihdr.buffer).setUint32(12, height);
  ihdr[16] = 8;
  ihdr[17] = 6;
  const chunks = [signature, ihdr];
  if (animated) chunks.push(chunk("acTL", 8));

  const minimumSize =
    chunks.reduce((total, bytes) => total + bytes.length, 0) + 12;
  if (size > minimumSize) {
    chunks.push(chunk("IDAT", size - minimumSize - 12));
  }
  chunks.push(chunk("IEND", 0));

  const bytes = new Uint8Array(
    chunks.reduce((total, chunkBytes) => total + chunkBytes.length, 0),
  );
  let offset = 0;
  for (const chunkBytes of chunks) {
    bytes.set(chunkBytes, offset);
    offset += chunkBytes.length;
  }
  return new File([bytes], name, { type: "image/png" });
}

function pngWithManyMetadataChunksFile(chunkCount: number): File {
  const chunk = (type: string, dataLength: number) => {
    const bytes = new Uint8Array(dataLength + 12);
    new DataView(bytes.buffer).setUint32(0, dataLength);
    bytes.set(new TextEncoder().encode(type), 4);
    return bytes;
  };
  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = chunk("IHDR", 13);
  new DataView(ihdr.buffer).setUint32(8, 1);
  new DataView(ihdr.buffer).setUint32(12, 1);
  const metadata = new Uint8Array(chunkCount * 12);
  const textType = new TextEncoder().encode("tEXt");
  for (let offset = 0; offset < metadata.length; offset += 12) {
    metadata.set(textType, offset + 4);
  }
  return new File(
    [
      signature,
      ihdr,
      metadata,
      chunk("acTL", 8),
      chunk("IDAT", 0),
      chunk("IEND", 0),
    ],
    "many-metadata.png",
    { type: "image/png" },
  );
}

function animatedGifFile(): File {
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0];
  return new File(
    [
      new Uint8Array([
        0x47,
        0x49,
        0x46,
        0x38,
        0x39,
        0x61,
        1,
        0,
        1,
        0,
        0,
        0,
        0,
        ...frame,
        ...frame,
        0x3b,
      ]),
    ],
    "animation.gif",
    { type: "image/gif" },
  );
}

function largeStaticGifFile(payloadBytes: number): File {
  const header = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0,
    1, 0, 1, 0, 0, 2,
  ]);
  const blockCount = Math.ceil(payloadBytes / 255);
  const subBlocks = new Uint8Array(payloadBytes + blockCount + 1);
  let payloadOffset = 0;
  let blockOffset = 0;
  while (payloadOffset < payloadBytes) {
    const blockLength = Math.min(255, payloadBytes - payloadOffset);
    subBlocks[blockOffset++] = blockLength;
    payloadOffset += blockLength;
    blockOffset += blockLength;
  }
  return new File(
    [header, subBlocks, new Uint8Array([0x3b])],
    "large-static.gif",
    { type: "image/gif" },
  );
}

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

  it("adds a supported extension to extensionless pasted images", async () => {
    const file = new File(["small image"], "clipboard", {
      type: "image/png",
    });

    const prepared = await preparePromptImageAttachment(file, 1_000);

    expect(prepared?.file.name).toBe("clipboard.png");
    expect(prepared?.file).not.toBe(file);
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

    const file = pngFile("reference.png", { size: 5 * 1024 * 1024 });
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

  it("does not flatten animated GIFs when their original image payload is too large", async () => {
    const createObjectURL = vi.fn(() => "blob:source-image");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });

    const preparation = preparePromptImageAttachment(animatedGifFile(), 1);
    await expect(preparation).rejects.toBeInstanceOf(
      PromptImageOptimizationError,
    );
    await expect(preparation).rejects.toMatchObject({
      name: "PromptImageOptimizationError",
      code: "animated-image-exceeds-data-url-budget",
    });

    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("scans large static GIF blocks without treating them as animation", async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({ drawImage: vi.fn() }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback, type?: string) =>
        callback(new Blob([new Uint8Array([1])], { type })),
    });
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1;
        naturalHeight = 1;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    const prepared = await preparePromptImageAttachment(
      largeStaticGifFile(5 * 1024 * 1024),
      1_000,
    );

    expect(prepared?.file.type).toBe("image/webp");
    expect(prepared?.dataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it("preserves APNG animation and refuses to flatten it when over budget", async () => {
    const smallAnimation = pngFile("animation.png", {
      size: 64,
      animated: true,
    });
    const prepared = await preparePromptImageAttachment(smallAnimation, 1_000);
    expect(prepared?.file).toBe(smallAnimation);

    const createObjectURL = vi.fn(() => "blob:source-image");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    const preparation = preparePromptImageAttachment(
      pngFile("animation.png", { size: 2_048, animated: true }),
      2_000,
    );
    await expect(preparation).rejects.toBeInstanceOf(
      PromptImageOptimizationError,
    );
    await expect(preparation).rejects.toMatchObject({
      code: "animated-image-exceeds-data-url-budget",
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("detects APNG animation after many small metadata chunks", async () => {
    const preparation = preparePromptImageAttachment(
      pngWithManyMetadataChunksFile(10_000),
      1,
    );

    await expect(preparation).rejects.toMatchObject({
      code: "animated-image-exceeds-data-url-budget",
    });
  });

  it("bounds PNG metadata scanning before image data", async () => {
    const preparation = preparePromptImageAttachment(
      pngWithManyMetadataChunksFile(100_000),
      1,
    );

    await expect(preparation).rejects.toMatchObject({
      code: "invalid-or-unsupported-image",
    });
  });

  it("does not fall back to JPEG for alpha-capable source images", async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({ drawImage: vi.fn() }),
    });
    const toBlob = vi.fn((callback: BlobCallback, type?: string) => {
      callback(
        type === "image/webp"
          ? null
          : new Blob([new Uint8Array(512)], { type }),
      );
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: toBlob,
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

    const prepared = await preparePromptImageAttachment(
      pngFile("transparent.png", { size: 2_048 }),
      2_000,
    );

    expect(prepared?.file.type).toBe("image/png");
    expect(toBlob.mock.calls.map(([, type]) => type)).toEqual([
      "image/webp",
      "image/png",
    ]);
  });

  it("rejects excessive source dimensions before creating a decoded image", async () => {
    const createObjectURL = vi.fn(() => "blob:source-image");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });

    const preparation = preparePromptImageAttachment(
      pngFile("huge.png", { width: 10_000, height: 5_000, size: 2_048 }),
      2_000,
    );
    await expect(preparation).rejects.toBeInstanceOf(
      PromptImageOptimizationError,
    );
    await expect(preparation).rejects.toMatchObject({
      code: "image-resolution-exceeds-safety-limit",
    });

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
