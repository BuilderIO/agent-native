import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  delegateImageGenerationToAssets: vi.fn(),
  getDeck: vi.fn(),
  getProvider: vi.fn(),
  updateSlide: vi.fn(),
  uploadFile: vi.fn(),
  uploadImageAsset: vi.fn(),
  getSlideSource: vi.fn(),
  updateSlideSource: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("../server/lib/assets-image-delegation.js", () => ({
  delegateImageGenerationToAssets: mocks.delegateImageGenerationToAssets,
  extractAssetUrl: vi.fn(),
  imagePreviewMarkdown: vi.fn(),
}));

vi.mock("../server/handlers/image-providers/index.js", () => ({
  getProvider: mocks.getProvider,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "user@example.com"),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(() => "org-1"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("../server/handlers/assets.js", () => ({
  MAX_ASSET_FILE_SIZE: 10 * 1024 * 1024,
  uploadImageAsset: mocks.uploadImageAsset,
}));

vi.mock("./get-deck.js", () => ({ default: { run: mocks.getDeck } }));
vi.mock("./update-slide.js", () => ({ default: { run: mocks.updateSlide } }));
vi.mock("./get-slide-source.js", () => ({
  default: { run: mocks.getSlideSource },
}));
vi.mock("./update-slide-source.js", () => ({
  default: { run: mocks.updateSlideSource },
}));

import generateImageApi from "./generate-image-api.js";

describe("generate-image-api reference image SSRF safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.ssrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      body: null,
      arrayBuffer: async () => Buffer.from("generated-image-bytes"),
    });
    mocks.uploadImageAsset.mockResolvedValue({
      id: "asset-1",
      url: "https://storage.example.com/deck-asset.png",
      filename: "generated.png",
      type: "image/png",
      size: 21,
    });
  });

  it("fetches reference images via ssrfSafeFetch with httpsOnly and maxRedirects", async () => {
    mocks.delegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "Assets service offline",
    });

    const mockProvider = {
      generate: vi.fn().mockResolvedValue({
        imageData: "fake-image-bytes",
        mimeType: "image/png",
        model: "mock-model",
      }),
    };
    mocks.getProvider.mockResolvedValue(mockProvider);
    mocks.uploadFile.mockResolvedValue({
      url: "https://storage.example.com/slide.png",
    });

    mocks.ssrfSafeFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    await generateImageApi.run({
      prompt: "A beautiful sunset",
      referenceImageUrls: ["https://example.com/style.png"],
    });

    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://example.com/style.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { httpsOnly: true, maxRedirects: 2 },
    );
  });

  it("discards reference images that return non-image mime types", async () => {
    mocks.delegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "Assets service offline",
    });

    const mockProvider = {
      generate: vi.fn().mockResolvedValue({
        imageData: "fake-image-bytes",
        mimeType: "image/png",
        model: "mock-model",
      }),
    };
    mocks.getProvider.mockResolvedValue(mockProvider);
    mocks.uploadFile.mockResolvedValue({
      url: "https://storage.example.com/slide.png",
    });

    mocks.ssrfSafeFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    await generateImageApi.run({
      prompt: "A beautiful sunset",
      referenceImageUrls: ["https://example.com/evil.html"],
    });

    expect(mockProvider.generate).toHaveBeenCalledWith(
      "A beautiful sunset",
      [],
    );
  });

  it("uses the source revision and hash when inserting a selected preview", async () => {
    const sourceTsx = [
      'import { ImagePlaceholder } from "@open-slide/core";',
      "export default function Slide() {",
      '  return <div><ImagePlaceholder label="Hero" /></div>;',
      "}",
    ].join("\n");
    const updatedSource = sourceTsx.replace(
      '<ImagePlaceholder label="Hero" />',
      "<img src=\"asset://asset-1\" alt='Hero' />",
    );
    const nextHash = "b".repeat(64);
    mocks.getDeck.mockResolvedValue({
      slides: [{ id: "slide-1", content: "<div></div>", sourceTsx }],
    });
    mocks.getSlideSource
      .mockResolvedValueOnce({
        slide: {
          sourceTsx,
          revision: 2,
          sourceHash: "a".repeat(64),
        },
      })
      .mockResolvedValueOnce({
        slide: { sourceTsx: updatedSource, revision: 3, sourceHash: nextHash },
      });
    mocks.updateSlideSource.mockResolvedValue({
      revision: 3,
      sourceHash: nextHash,
    });

    const result = await generateImageApi.run({
      prompt: "A beautiful sunset",
      deckId: "deck-1",
      slideId: "slide-1",
      generatedImageUrl: "https://cdn.example.com/generated.png",
      insertIntoSlide: true,
    });

    expect(result).toMatchObject({ inserted: true, assetId: "asset-1" });
    expect(mocks.updateSlideSource).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 2,
        expectedSourceHash: "a".repeat(64),
        edits: [
          expect.objectContaining({
            ops: [
              {
                kind: "replace-placeholder-with-image",
                assetId: "asset-1",
              },
            ],
          }),
        ],
      }),
    );
    expect(mocks.updateSlide).not.toHaveBeenCalled();
  });
});
