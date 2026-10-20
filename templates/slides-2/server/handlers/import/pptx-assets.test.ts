import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  storeLocalImportedAsset: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));

vi.mock("../../lib/import-asset-storage.js", () => ({
  storeLocalImportedAsset: (...args: unknown[]) =>
    mocks.storeLocalImportedAsset(...args),
}));

import { uploadPptxSlideImages } from "./pptx-assets.js";

describe("uploadPptxSlideImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadFile.mockResolvedValue({
      url: "https://storage.example/slide.png",
      provider: "s3",
      id: "object-1",
    });
  });

  it("returns and reports the provider identity needed for later cleanup", async () => {
    const onUploaded = vi.fn();
    const result = await uploadPptxSlideImages({
      slide: {
        texts: [],
        images: [],
        elements: [
          {
            id: "image-element-1",
            kind: "image",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            image: {
              data: new Uint8Array([1, 2, 3]),
              mimeType: "image/png",
              name: "slide.png",
            },
          },
        ],
      },
      slideIndex: 0,
      ownerEmail: "owner@example.com",
      onUploaded,
    });

    const asset = result.assets["image-element-1"]!;
    expect(asset).toMatchObject({
      filename: "slide.png",
      url: "https://storage.example/slide.png",
      mimeType: "image/png",
      size: 3,
      provider: "s3",
      providerObjectId: "object-1",
    });
    expect(asset.assetId).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(result.urls).toEqual({
      "image-element-1": "https://storage.example/slide.png",
    });
    expect(onUploaded).toHaveBeenCalledWith(asset);
  });

  it("records the local fallback identity when provider upload fails", async () => {
    mocks.uploadFile.mockRejectedValue(new Error("provider unavailable"));
    mocks.storeLocalImportedAsset.mockResolvedValue({
      url: "/api/import-assets/token",
      id: "local-object-1",
      provider: "slides-import-local",
    });
    const onUploaded = vi.fn();

    const result = await uploadPptxSlideImages({
      slide: {
        texts: [],
        images: [],
        elements: [
          {
            id: "image-element-1",
            kind: "image",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            image: {
              data: new Uint8Array([1]),
              mimeType: "image/png",
              name: "slide.png",
            },
          },
        ],
      },
      slideIndex: 0,
      ownerEmail: "owner@example.com",
      onUploaded,
    });

    expect(result.assets["image-element-1"]).toMatchObject({
      url: "/api/import-assets/token",
      provider: "slides-import-local",
      providerObjectId: "local-object-1",
    });
    expect(onUploaded).toHaveBeenCalledWith(result.assets["image-element-1"]);
  });
});
