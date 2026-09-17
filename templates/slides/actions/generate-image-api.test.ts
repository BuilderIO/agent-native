import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDelegateImageGenerationToAssets,
  mockExtractAssetUrl,
  mockUploadFile,
  mockGetProvider,
  mockProviderGenerate,
  mockGetDeckRun,
  mockUpdateSlideRun,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockExtractAssetUrl: vi.fn(() => "https://cdn.example.com/generated.png"),
  mockUploadFile: vi.fn(),
  mockGetProvider: vi.fn(),
  mockProviderGenerate: vi.fn(),
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
    DEFAULT_STYLE_REFERENCE_URLS.splice(0, DEFAULT_STYLE_REFERENCE_URLS.length);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function deckWithSlide(content: string) {
    return { slides: [{ id: "slide-1", content }] };
  }

  it("forwards referenceImageUrls to Assets delegation", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });

    const result = await action.run({
      prompt: "a brand hero image",
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const body = url.includes("default-style")
          ? "default-style-bytes"
          : url.includes("style-1")
            ? "style-1-bytes"
            : "style-2-bytes";
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/png" }),
          arrayBuffer: async () => Buffer.from(body),
        } as Response;
      }),
    );

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
      referenceImageUrls: [
        " https://cdn.example.com/style-1.png ",
        "",
        "https://cdn.example.com/style-1.png",
        "https://cdn.example.com/style-2.png",
      ],
    });

    expect(mockProviderGenerate).toHaveBeenCalledWith("a brand hero image", [
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
    ]);
    expect(result).toMatchObject({
      source: "slides-fallback",
      fallbackReason: "Assets offline",
      prompt: "a brand hero image",
      url: "https://cdn.example.com/fallback.png",
      showToUser: "![a brand hero image](https://cdn.example.com/fallback.png)",
      model: "gemini",
    });
  });

  it("inserts and verifies an Assets image when requested", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun
      .mockResolvedValueOnce(
        deckWithSlide(
          '<div class="fmd-slide"><div class="fmd-img-placeholder">Hero</div></div>',
        ),
      )
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
    });

    expect(mockUpdateSlideRun).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        slideId: "slide-1",
        preserveSource: true,
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
      }),
    ).rejects.toThrow("was not applied");

    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: true });
    await expect(
      action.run({
        prompt: "a brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        insertIntoSlide: true,
      }),
    ).rejects.toThrow("could not be verified");
  });
});
