import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSlideContent } from "../shared/slide-fit.js";

const {
  mockDelegateImageGenerationToAssets,
  mockExtractAssetUrl,
  mockUploadFile,
  mockGetProvider,
  mockProviderGenerate,
  mockFetchReferenceImages,
  mockGetDeckRun,
  mockUpdateSlideRun,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockExtractAssetUrl: vi.fn(() => "https://cdn.example.com/generated.png"),
  mockUploadFile: vi.fn(),
  mockGetProvider: vi.fn(),
  mockProviderGenerate: vi.fn(),
  mockFetchReferenceImages: vi.fn(),
  mockGetDeckRun: vi.fn(),
  mockUpdateSlideRun: vi.fn(),
}));

vi.mock("../server/lib/assets-image-delegation.js", () => ({
  delegateImageGenerationToAssets: (
    ...args: Parameters<typeof mockDelegateImageGenerationToAssets>
  ) => mockDelegateImageGenerationToAssets(...args),
  extractAssetUrl: (...args: Parameters<typeof mockExtractAssetUrl>) =>
    mockExtractAssetUrl(...args),
  imagePreviewMarkdown: (prompt: string, url: string) => `![${prompt}](${url})`,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: Parameters<typeof mockUploadFile>) =>
    mockUploadFile(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "author@example.com",
}));

vi.mock("../server/handlers/image-providers/index.js", () => ({
  getProvider: (...args: Parameters<typeof mockGetProvider>) =>
    mockGetProvider(...args),
}));

vi.mock("../server/lib/reference-image-fetch.js", () => ({
  MAX_REFERENCE_IMAGE_COUNT: 8,
  MAX_REFERENCE_IMAGE_INPUT_COUNT: 32,
  fetchReferenceImages: (
    ...args: Parameters<typeof mockFetchReferenceImages>
  ) => mockFetchReferenceImages(...args),
}));

vi.mock("./get-deck.js", () => ({
  default: {
    run: (...args: Parameters<typeof mockGetDeckRun>) =>
      mockGetDeckRun(...args),
  },
}));

vi.mock("./update-slide.js", () => ({
  default: {
    run: (...args: Parameters<typeof mockUpdateSlideRun>) =>
      mockUpdateSlideRun(...args),
  },
}));

import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";
import action from "./generate-image-api.js";

describe("generate-image-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractAssetUrl.mockReturnValue(
      "https://cdn.example.com/generated.png",
    );
    mockFetchReferenceImages.mockReset();
    mockFetchReferenceImages.mockResolvedValue({
      requested: 0,
      attempted: 0,
      loaded: 0,
      failed: 0,
      skipped: 0,
      totalBytes: 0,
      images: [],
      failures: [],
      skippedReasons: [],
    });
    DEFAULT_STYLE_REFERENCE_URLS.splice(0, DEFAULT_STYLE_REFERENCE_URLS.length);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function deckWithSlide(content: string) {
    return {
      slides: [
        { id: "slide-1", content, contentHash: hashSlideContent(content) },
      ],
    };
  }

  it("uses local image generation by default without contacting Assets", async () => {
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("local-image"),
      mimeType: "image/png",
      model: "gemini",
      provider: "gemini",
      referenceImagesSubmitted: 0,
    });
    mockGetProvider.mockResolvedValue({ generate: mockProviderGenerate });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/local.png",
    });

    const result = await action.run({
      prompt: "a sunset",
      slideContent: "<div>Quarterly revenue growth</div>",
    });

    expect(mockDelegateImageGenerationToAssets).not.toHaveBeenCalled();
    expect(mockProviderGenerate).toHaveBeenCalledWith("a sunset", [], {
      slideContent: "<div>Quarterly revenue growth</div>",
    });
    expect(result).toMatchObject({
      source: "slides-local",
      prompt: "a sunset",
      url: "https://cdn.example.com/local.png",
      provider: "gemini",
      referenceImages: {
        submittedToProvider: 0,
      },
    });
  });

  it("reports the number of references submitted to the selected provider", async () => {
    const images = Array.from({ length: 6 }, (_, index) => ({
      data: `image-${index + 1}`,
      mimeType: "image/png",
      byteLength: 1,
    }));
    mockFetchReferenceImages.mockResolvedValue({
      requested: 6,
      attempted: 6,
      loaded: 6,
      failed: 0,
      skipped: 0,
      totalBytes: 6,
      images,
      failures: [],
      skippedReasons: [],
    });
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("local-image"),
      mimeType: "image/png",
      model: "gemini-3.1-flash-image",
      provider: "gemini",
      referenceImagesSubmitted: 4,
    });
    mockGetProvider.mockResolvedValue({ generate: mockProviderGenerate });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/local.png",
    });

    const result = await action.run({
      prompt: "a sunset",
      referenceImageUrls: Array.from(
        { length: 6 },
        (_, index) => `https://cdn.example.com/style-${index + 1}.png`,
      ),
    });

    expect(result).toMatchObject({
      provider: "gemini",
      referenceImages: {
        requested: 6,
        loaded: 6,
        submittedToProvider: 4,
      },
    });
  });

  it("forwards referenceImageUrls to Assets delegation", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });

    const result = await action.run({
      prompt: "a brand hero image",
      useBrandLibrary: true,
      referenceImageUrls: [
        " https://cdn.example.com/style-1.png ",
        "",
        "https://cdn.example.com/style-1.png",
        "https://cdn.example.com/style-2.png",
      ],
    });

    expect(mockDelegateImageGenerationToAssets).toHaveBeenCalledWith({
      prompt: "a brand hero image",
      deckId: undefined,
      slideId: undefined,
      slideContent: undefined,
      referenceImageUrls: [
        "https://cdn.example.com/style-1.png",
        "https://cdn.example.com/style-2.png",
      ],
    });
    expect(result).toMatchObject({
      source: "assets-a2a",
      prompt: "a brand hero image",
      url: "https://cdn.example.com/generated.png",
      showToUser:
        "![a brand hero image](https://cdn.example.com/generated.png)",
    });
  });

  it("includes explicit referenceImageUrls in the local fallback provider refs", async () => {
    DEFAULT_STYLE_REFERENCE_URLS.push(
      "https://cdn.example.com/default-style.png",
    );
    mockFetchReferenceImages.mockImplementation(async (urls: string[]) => {
      const images = urls.map((url) => {
        const body = url.includes("default-style")
          ? "default-style-bytes"
          : url.includes("style-1")
            ? "style-1-bytes"
            : "style-2-bytes";
        return {
          data: Buffer.from(body).toString("base64"),
          mimeType: "image/png",
          byteLength: Buffer.byteLength(body),
        };
      });
      return {
        requested: urls.length,
        attempted: urls.length,
        loaded: urls.length,
        failed: 0,
        skipped: 0,
        totalBytes: images.reduce(
          (total, image) => total + image.byteLength,
          0,
        ),
        images,
        failures: [],
        skippedReasons: [],
      };
    });

    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "Assets offline",
    });
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("fallback-image"),
      mimeType: "image/png",
      model: "gemini",
    });
    mockGetProvider.mockResolvedValue({
      generate: mockProviderGenerate,
    });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/fallback.png",
    });

    const result = await action.run({
      prompt: "a brand hero image",
      useBrandLibrary: true,
      referenceImageUrls: [
        " https://cdn.example.com/style-1.png ",
        "",
        "https://cdn.example.com/style-1.png",
        "https://cdn.example.com/style-2.png",
      ],
    });

    expect(mockProviderGenerate).toHaveBeenCalledWith(
      "a brand hero image",
      [
        {
          data: Buffer.from("default-style-bytes").toString("base64"),
          mimeType: "image/png",
        },
        {
          data: Buffer.from("style-1-bytes").toString("base64"),
          mimeType: "image/png",
        },
        {
          data: Buffer.from("style-2-bytes").toString("base64"),
          mimeType: "image/png",
        },
      ],
      undefined,
    );
    expect(result).toMatchObject({
      source: "slides-fallback",
      fallbackReason: "Assets offline",
      prompt: "a brand hero image",
      url: "https://cdn.example.com/fallback.png",
      showToUser: "![a brand hero image](https://cdn.example.com/fallback.png)",
      model: "gemini",
      referenceImages: {
        requested: 3,
        attempted: 3,
        loaded: 3,
        failed: 0,
        skipped: 0,
        bytesLoaded: expect.any(Number),
        failures: [],
        skippedReasons: [],
      },
    });
  });

  it("reports reference URLs omitted from local generation", async () => {
    mockFetchReferenceImages.mockResolvedValue({
      requested: 1,
      attempted: 1,
      loaded: 0,
      failed: 1,
      skipped: 0,
      totalBytes: 0,
      images: [],
      failures: [{ index: 1, reason: { code: "http_error", status: 403 } }],
      skippedReasons: [],
    });
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("local-image"),
      mimeType: "image/png",
      model: "gemini",
    });
    mockGetProvider.mockResolvedValue({ generate: mockProviderGenerate });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/local.png",
    });

    const result = await action.run({
      prompt: "a sunset",
      referenceImageUrls: ["https://cdn.example.com/style.png"],
    });

    expect(result).toMatchObject({
      referenceImages: {
        requested: 1,
        attempted: 1,
        loaded: 0,
        failed: 1,
        skipped: 0,
        bytesLoaded: 0,
        failures: [{ index: 1, reason: { code: "http_error", status: 403 } }],
        skippedReasons: [],
      },
    });
  });

  it("rejects oversized reference URL arrays before fetching", async () => {
    await expect(
      action.run({
        prompt: "a sunset",
        referenceImageUrls: Array.from(
          { length: 33 },
          (_, index) => `https://cdn.example.com/${index}.png`,
        ),
      }),
    ).rejects.toThrow();
    expect(mockFetchReferenceImages).not.toHaveBeenCalled();
  });

  it("fails when Assets is unavailable without a reason", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "  ",
    });

    await expect(
      action.run({ prompt: "a brand hero image", useBrandLibrary: true }),
    ).rejects.toThrow("without a reason");
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it("inserts and verifies an Assets image when requested", async () => {
    const sourceContent =
      '<div class="fmd-slide"><div class="fmd-img-placeholder">Hero</div></div>';
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun
      .mockResolvedValueOnce(deckWithSlide(sourceContent))
      .mockResolvedValueOnce(
        deckWithSlide(
          '<div class="fmd-slide"><img src="https://cdn.example.com/generated.png"></div>',
        ),
      );
    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: true });

    const result = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
      useBrandLibrary: true,
    });

    expect(mockUpdateSlideRun).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        slideId: "slide-1",
        preserveSource: true,
        baseContentHash: hashSlideContent(sourceContent),
        fullContent: expect.stringContaining(
          'src="https://cdn.example.com/generated.png"',
        ),
      }),
    );
    expect(mockGetDeckRun).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      inserted: true,
      url: "https://cdn.example.com/generated.png",
    });
  });

  it("returns the generated Assets URL when the target slide is missing", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun.mockResolvedValue({ slides: [] });

    const result = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "missing-slide",
      insertIntoSlide: true,
      useBrandLibrary: true,
    });
    expect(result).toMatchObject({
      url: "https://cdn.example.com/generated.png",
      showToUser:
        "![a brand hero image](https://cdn.example.com/generated.png)",
      inserted: false,
      insertionError: expect.stringContaining("was not found"),
    });
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
  });

  it("reports insertion failure when Assets returns no parseable image URL", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "The image is ready.",
      target: "https://assets.example.com",
    });
    mockExtractAssetUrl.mockReturnValue(null);

    const result = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
      useBrandLibrary: true,
    });
    expect(result).toMatchObject({
      source: "assets-a2a",
      inserted: false,
      insertionError: expect.stringContaining(
        "did not return a parseable image URL",
      ),
    });
    expect(mockGetDeckRun).not.toHaveBeenCalled();
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
  });

  it("returns the generated Assets URL when insertion fails or cannot be verified", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun.mockResolvedValue(
      deckWithSlide('<div class="fmd-slide">Original</div>'),
    );
    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: false });

    const failedWrite = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
      useBrandLibrary: true,
    });
    expect(failedWrite).toMatchObject({
      url: "https://cdn.example.com/generated.png",
      inserted: false,
      insertionError: expect.stringContaining("was not applied"),
    });

    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: true });
    const unverified = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
      useBrandLibrary: true,
    });
    expect(unverified).toMatchObject({
      url: "https://cdn.example.com/generated.png",
      inserted: false,
      insertionError: expect.stringContaining("could not be verified"),
    });
  });

  it("preserves a locally uploaded image URL when slide insertion fails", async () => {
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("local-image"),
      mimeType: "image/png",
      model: "gemini",
      provider: "gemini",
    });
    mockGetProvider.mockResolvedValue({ generate: mockProviderGenerate });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/local.png",
    });
    mockGetDeckRun.mockResolvedValue(
      deckWithSlide('<div class="fmd-slide">Original</div>'),
    );
    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: false });

    const result = await action.run({
      prompt: "a local hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
    });

    expect(result).toMatchObject({
      source: "slides-local",
      url: "https://cdn.example.com/local.png",
      showToUser: "![a local hero image](https://cdn.example.com/local.png)",
      inserted: false,
      insertionError: expect.stringContaining("was not applied"),
    });
  });
});
