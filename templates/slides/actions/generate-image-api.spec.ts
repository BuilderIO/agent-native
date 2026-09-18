import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  delegateImageGenerationToAssets: vi.fn(),
  getProvider: vi.fn(),
  uploadFile: vi.fn(),
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

vi.mock("./get-deck.js", () => ({ default: { run: vi.fn() } }));
vi.mock("./update-slide.js", () => ({ default: { run: vi.fn() } }));

import generateImageApi from "./generate-image-api.js";

describe("generate-image-api reference image SSRF safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches reference images via ssrfSafeFetch with httpsOnly and maxRedirects", async () => {
    mocks.delegateImageGenerationToAssets.mockResolvedValue({
      status: "unreachable",
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
      status: "unreachable",
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
});
