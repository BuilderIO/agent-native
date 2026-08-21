import { describe, expect, it, vi } from "vitest";

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

function slideWithImage(mimeType: string): ParsedSlide {
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
          data: new Uint8Array([1, 2, 3]),
        },
      },
    ],
  } as ParsedSlide;
}

describe("PPTX image uploads", () => {
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
});
