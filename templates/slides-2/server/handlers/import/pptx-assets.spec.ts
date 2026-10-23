import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertPptxImagesRenderable,
  uploadPptxSlideImages,
} from "./pptx-assets.js";
import type { ParsedSlide } from "./pptx-parser.js";

const uploadFileMock = vi.hoisted(() => vi.fn());
const storeLocalImportedAssetMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: uploadFileMock,
}));
vi.mock("../../lib/import-asset-storage.js", () => ({
  storeLocalImportedAsset: storeLocalImportedAssetMock,
}));

function slideWithImage(
  mimeType: string,
  data = new Uint8Array([1, 2, 3]),
): ParsedSlide {
  return {
    texts: [],
    images: [],
    elements: [
      {
        id: "image-1",
        kind: "image",
        name: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          name: "image.bin",
          mimeType,
          data,
        },
      },
    ],
  } as ParsedSlide;
}

describe("PPTX image uploads", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    storeLocalImportedAssetMock.mockReset();
  });

  it("rejects unsupported image types before the upload phase", () => {
    expect(() =>
      assertPptxImagesRenderable([slideWithImage("image/tiff")]),
    ).toThrow("No images were uploaded");
  });

  it("uploads browser-renderable images", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://files.example/image.png",
      provider: "test",
    });

    const slide = slideWithImage("image/png");
    assertPptxImagesRenderable([slide]);
    await expect(
      uploadPptxSlideImages({
        slide,
        slideIndex: 0,
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toMatchObject({
      urls: { "image-1": "https://files.example/image.png" },
      imageSkippedCount: 0,
    });
  });

  it("rejects a decompressed image over the per-image limit before upload", async () => {
    const slide = slideWithImage(
      "image/png",
      new Uint8Array(10 * 1024 * 1024 + 1),
    );

    await expect(
      uploadPptxSlideImages({
        slide,
        slideIndex: 0,
        ownerEmail: "owner@example.com",
      }),
    ).rejects.toMatchObject({
      errorCode: "pptx_image_size_limit",
      statusCode: 413,
    });
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(storeLocalImportedAssetMock).not.toHaveBeenCalled();
  });

  it("rejects aggregate decompressed image bytes before any image upload", () => {
    const tenMegabytes = new Uint8Array(10 * 1024 * 1024);
    const slides = [
      slideWithImage("image/png", tenMegabytes),
      slideWithImage("image/png", tenMegabytes),
      slideWithImage("image/png", tenMegabytes),
      slideWithImage("image/png", tenMegabytes),
      slideWithImage("image/png", new Uint8Array([1])),
    ];

    let thrown: unknown;
    try {
      assertPptxImagesRenderable(slides);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      errorCode: "pptx_image_size_limit",
      statusCode: 413,
    });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});
