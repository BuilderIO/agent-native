import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashSlideContent } from "../shared/slide-fit.js";

const {
  mockDelegateImageGenerationToAssets,
  mockExtractAssetUrl,
  mockUploadFile,
  mockGetProvider,
  mockProviderGenerate,
  mockFetchReferenceImage,
  mockGetDeckRun,
  mockUpdateSlideRun,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockExtractAssetUrl: vi.fn(() => "https://cdn.example.com/generated.png"),
  mockUploadFile: vi.fn(),
  mockGetProvider: vi.fn(),
  mockProviderGenerate: vi.fn(),
  mockFetchReferenceImage: vi.fn(),
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
  fetchReferenceImage: (...args: Parameters<typeof mockFetchReferenceImage>) =>
    mockFetchReferenceImage(...args),
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
    mockFetchReferenceImage.mockReset();
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
    mockFetchReferenceImage.mockImplementation(async (url: string) => {
      const body = url.includes("default-style")
        ? "default-style-bytes"
        : url.includes("style-1")
          ? "style-1-bytes"
          : "style-2-bytes";
      return {
        ok: true,
        image: {
          data: Buffer.from(body).toString("base64"),
          mimeType: "image/png",
        },
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
        loaded: 3,
        failed: 0,
        failures: [],
      },
    });
  });

  it("reports reference URLs omitted from local generation", async () => {
    mockFetchReferenceImage.mockResolvedValue({
      ok: false,
      reason: { code: "http_error", status: 403 },
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
        loaded: 0,
        failed: 1,
        failures: [{ index: 1, reason: { code: "http_error", status: 403 } }],
      },
    });
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

  it("rejects insertion when the target slide is missing", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun.mockResolvedValue({ slides: [] });

    await expect(
      action.run({
        prompt: "a brand hero image",
        deckId: "deck-1",
        slideId: "missing-slide",
        insertIntoSlide: true,
        useBrandLibrary: true,
      }),
    ).rejects.toThrow("was not found");
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
  });

  it("rejects insertion when Assets returns no parseable image URL", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "The image is ready.",
      target: "https://assets.example.com",
    });
    mockExtractAssetUrl.mockReturnValue(null);

    await expect(
      action.run({
        prompt: "a brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        insertIntoSlide: true,
        useBrandLibrary: true,
      }),
    ).rejects.toThrow("did not return a parseable image URL");
    expect(mockGetDeckRun).not.toHaveBeenCalled();
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
  });

  it("rejects insertion when the write fails or cannot be verified", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun.mockResolvedValue(
      deckWithSlide('<div class="fmd-slide">Original</div>'),
    );
    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: false });

    await expect(
      action.run({
        prompt: "a brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        insertIntoSlide: true,
        useBrandLibrary: true,
      }),
    ).rejects.toThrow("was not applied");

    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: true });
    await expect(
      action.run({
        prompt: "a brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        insertIntoSlide: true,
        useBrandLibrary: true,
      }),
    ).rejects.toThrow("could not be verified");
  });
});
