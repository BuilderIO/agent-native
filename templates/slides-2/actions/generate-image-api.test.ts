import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashSlideContent } from "../shared/slide-fit.js";

const {
  mockDelegateImageGenerationToAssets,
  mockExtractAssetUrl,
  mockUploadFile,
  mockUploadImageAsset,
  mockSsrfSafeFetch,
  mockGetProvider,
  mockProviderGenerate,
  mockGetDeckRun,
  mockUpdateSlideRun,
  mockGetSlideSourceRun,
  mockUpdateSlideSourceRun,
  mockAssertAccess,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockExtractAssetUrl: vi.fn(() => "https://cdn.example.com/generated.png"),
  mockUploadFile: vi.fn(),
  mockUploadImageAsset: vi.fn(),
  mockSsrfSafeFetch: vi.fn(),
  mockGetProvider: vi.fn(),
  mockProviderGenerate: vi.fn(),
  mockGetDeckRun: vi.fn(),
  mockUpdateSlideRun: vi.fn(),
  mockGetSlideSourceRun: vi.fn(),
  mockUpdateSlideSourceRun: vi.fn(),
  mockAssertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: Parameters<typeof mockSsrfSafeFetch>) =>
    mockSsrfSafeFetch(...args),
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

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/handlers/assets.js", () => ({
  MAX_ASSET_FILE_SIZE: 10 * 1024 * 1024,
  uploadImageAsset: (...args: Parameters<typeof mockUploadImageAsset>) =>
    mockUploadImageAsset(...args),
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

vi.mock("./get-slide-source.js", () => ({
  default: {
    run: (...args: Parameters<typeof mockGetSlideSourceRun>) =>
      mockGetSlideSourceRun(...args),
  },
}));

vi.mock("./update-slide-source.js", () => ({
  default: {
    run: (...args: Parameters<typeof mockUpdateSlideSourceRun>) =>
      mockUpdateSlideSourceRun(...args),
  },
}));

import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";
import action from "./generate-image-api.js";

describe("generate-image-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue(undefined);
    mockExtractAssetUrl.mockReturnValue(
      "https://cdn.example.com/generated.png",
    );
    mockSsrfSafeFetch.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      const body = url.includes("default-style")
        ? "default-style-bytes"
        : url.includes("style-1")
          ? "style-1-bytes"
          : url.includes("style-2")
            ? "style-2-bytes"
            : "generated-image-bytes";
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "image/png" }),
        body: null,
        arrayBuffer: async () => Buffer.from(body),
      } as Response;
    });
    mockUploadImageAsset.mockResolvedValue({
      id: "asset-1",
      url: "https://cdn.example.com/deck-asset.png",
      filename: "generated.png",
      type: "image/png",
      size: 21,
    });
    DEFAULT_STYLE_REFERENCE_URLS.splice(0, DEFAULT_STYLE_REFERENCE_URLS.length);
  });

  function deckWithSlide(content: string) {
    return {
      slides: [
        { id: "slide-1", content, contentHash: hashSlideContent(content) },
      ],
    };
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

  it("rejects unsafe and excessive reference URLs at the action boundary", () => {
    const credentialedUrl = new URL("https://images.example.com/style.png");
    credentialedUrl.username = "placeholder";
    credentialedUrl.password = "placeholder";

    expect(() =>
      action.schema.parse({
        prompt: "a brand hero image",
        referenceImageUrls: ["http://images.example.com/style.png"],
      }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        prompt: "a brand hero image",
        referenceImageUrls: [credentialedUrl.toString()],
      }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        prompt: "a brand hero image",
        referenceImageUrls: Array.from(
          { length: 9 },
          (_, index) => `https://images.example.com/${index}.png`,
        ),
      }),
    ).toThrow();
  });

  it("includes explicit referenceImageUrls in the local fallback provider refs", async () => {
    DEFAULT_STYLE_REFERENCE_URLS.push(
      "https://cdn.example.com/default-style.png",
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

  it("skips reference downloads that exceed the byte limit", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "Assets offline",
    });
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("fallback-image"),
      mimeType: "image/png",
      model: "gemini",
    });
    mockGetProvider.mockResolvedValue({ generate: mockProviderGenerate });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/fallback.png",
    });
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(null, {
        headers: {
          "content-type": "image/png",
          "content-length": String(5 * 1024 * 1024 + 1),
        },
      }),
    );

    await action.run({
      prompt: "a brand hero image",
      referenceImageUrls: ["https://cdn.example.com/too-large.png"],
    });

    expect(mockProviderGenerate).toHaveBeenCalledWith("a brand hero image", []);
  });

  it("skips reference downloads without a supported image content type", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "Assets offline",
    });
    mockProviderGenerate.mockResolvedValue({
      imageData: Buffer.from("fallback-image"),
      mimeType: "image/png",
      model: "gemini",
    });
    mockGetProvider.mockResolvedValue({ generate: mockProviderGenerate });
    mockUploadFile.mockResolvedValue({
      url: "https://cdn.example.com/fallback.png",
    });
    mockSsrfSafeFetch.mockResolvedValue(new Response(Uint8Array.from([1])));

    await action.run({
      prompt: "a brand hero image",
      referenceImageUrls: ["https://cdn.example.com/not-an-image"],
    });

    expect(mockProviderGenerate).toHaveBeenCalledWith("a brand hero image", []);
  });

  it("registers an Assets image and inserts it into a legacy HTML slide", async () => {
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
          '<div class="fmd-slide"><img src="https://cdn.example.com/deck-asset.png"></div>',
        ),
      );
    mockUpdateSlideRun.mockResolvedValue({ ok: true, applied: true });

    const result = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
    });

    expect(mockUploadImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "author@example.com",
        orgId: "org-1",
        deckId: "deck-1",
        type: "image/png",
        data: Buffer.from("generated-image-bytes"),
      }),
    );
    expect(mockUpdateSlideRun).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        slideId: "slide-1",
        preserveSource: true,
        baseContentHash: hashSlideContent(sourceContent),
        fullContent: expect.stringContaining(
          'src="https://cdn.example.com/deck-asset.png"',
        ),
      }),
    );
    expect(mockUpdateSlideSourceRun).not.toHaveBeenCalled();
    expect(mockGetDeckRun).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      inserted: true,
      url: "https://cdn.example.com/deck-asset.png",
      assetId: "asset-1",
    });
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
  });

  it("checks edit access before asking Assets to generate an insertion", async () => {
    mockAssertAccess.mockRejectedValue(
      Object.assign(new Error("No access to deck"), {
        errorCode: "forbidden",
        statusCode: 403,
      }),
    );

    await expect(
      action.run({
        prompt: "a brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        insertIntoSlide: true,
      }),
    ).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });

    expect(mockDelegateImageGenerationToAssets).not.toHaveBeenCalled();
    expect(mockUploadImageAsset).not.toHaveBeenCalled();
  });

  it("registers a selected preview and saves a source-backed slide with CAS", async () => {
    const sourceTsx = [
      'import { ImagePlaceholder } from "@open-slide/core";',
      "export default function Slide() {",
      '  return <div><ImagePlaceholder label="Hero" /></div>;',
      "}",
    ].join("\n");
    const updatedSource = sourceTsx.replace(
      '<ImagePlaceholder label="Hero" />',
      "<img src=\"asset://asset-1\" alt='Hero' style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 50%' }} />",
    );
    const originalHash = "a".repeat(64);
    const updatedHash = "b".repeat(64);
    mockGetDeckRun.mockResolvedValue({
      slides: [
        {
          id: "slide-1",
          content: "<div></div>",
          contentHash: hashSlideContent("<div></div>"),
          sourceTsx,
        },
      ],
    });
    mockGetSlideSourceRun
      .mockResolvedValueOnce({
        slide: {
          sourceTsx,
          revision: 7,
          sourceHash: originalHash,
        },
      })
      .mockResolvedValueOnce({
        slide: {
          sourceTsx: updatedSource,
          revision: 8,
          sourceHash: updatedHash,
        },
      });
    mockUpdateSlideSourceRun.mockResolvedValue({
      revision: 8,
      sourceHash: updatedHash,
    });

    const result = await action.run({
      prompt: "a brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      generatedImageUrl: "https://cdn.example.com/generated.png",
      insertIntoSlide: true,
    });

    expect(mockDelegateImageGenerationToAssets).not.toHaveBeenCalled();
    expect(mockUploadImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        type: "image/png",
        data: Buffer.from("generated-image-bytes"),
      }),
    );
    expect(mockUpdateSlideSourceRun).toHaveBeenCalledWith({
      deckId: "deck-1",
      slideId: "slide-1",
      expectedRevision: 7,
      expectedSourceHash: originalHash,
      edits: [
        {
          line: 3,
          column: 14,
          ops: [{ kind: "replace-placeholder-with-image", assetId: "asset-1" }],
        },
      ],
    });
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "selected-preview",
      inserted: true,
      assetId: "asset-1",
      revision: 8,
      sourceHash: updatedHash,
      url: "https://cdn.example.com/deck-asset.png",
    });
  });

  it("inserts an asset into a source-backed slide without a placeholder", async () => {
    const sourceTsx = [
      "export default function Slide() {",
      '  return <div style={{ width: "1920px", height: "1080px" }}><h1>Title</h1></div>;',
      "}",
    ].join("\n");
    const updatedSource = sourceTsx.replace(
      "<h1>Title</h1>",
      '<img src="asset://asset-1" alt="A brand hero image" /><h1>Title</h1>',
    );
    const sourceHash = "c".repeat(64);
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "delegated",
      reply: "previewUrl: https://cdn.example.com/generated.png",
      target: "https://assets.example.com",
    });
    mockGetDeckRun.mockResolvedValue({
      slides: [{ id: "slide-1", content: "<div></div>", sourceTsx }],
    });
    mockGetSlideSourceRun
      .mockResolvedValueOnce({
        slide: { sourceTsx, revision: 2, sourceHash },
      })
      .mockResolvedValueOnce({
        slide: {
          sourceTsx: updatedSource,
          revision: 3,
          sourceHash: "d".repeat(64),
        },
      });
    mockUpdateSlideSourceRun.mockResolvedValue({
      revision: 3,
      sourceHash: "d".repeat(64),
    });

    await action.run({
      prompt: "A brand hero image",
      deckId: "deck-1",
      slideId: "slide-1",
      insertIntoSlide: true,
    });

    expect(mockUpdateSlideSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 2,
        expectedSourceHash: sourceHash,
        edits: [
          {
            line: 2,
            column: 9,
            ops: [
              {
                kind: "insert-image-asset",
                assetId: "asset-1",
                alt: "A brand hero image",
              },
            ],
          },
        ],
      }),
    );
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
  });

  it("does not report insertion when source revision compare-and-swap conflicts", async () => {
    const sourceTsx = "export default function Slide() { return <div />; }";
    mockGetDeckRun.mockResolvedValue({
      slides: [{ id: "slide-1", content: "<div></div>", sourceTsx }],
    });
    mockGetSlideSourceRun.mockResolvedValue({
      slide: {
        sourceTsx,
        revision: 4,
        sourceHash: "e".repeat(64),
      },
    });
    mockUpdateSlideSourceRun.mockRejectedValue(
      Object.assign(
        new Error("Slide source changed while you were editing it."),
        {
          errorCode: "slide_source_conflict",
          statusCode: 409,
        },
      ),
    );

    await expect(
      action.run({
        prompt: "A brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        insertIntoSlide: true,
        generatedImageUrl: "https://cdn.example.com/generated.png",
      }),
    ).rejects.toMatchObject({
      errorCode: "slide_source_conflict",
      statusCode: 409,
    });
    expect(mockGetSlideSourceRun).toHaveBeenCalledTimes(1);
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
  });

  it("does not report insertion when source readback omits the asset handle", async () => {
    const sourceTsx = "export default function Slide() { return <div />; }";
    const sourceHash = "f".repeat(64);
    mockGetDeckRun.mockResolvedValue({
      slides: [{ id: "slide-1", content: "<div></div>", sourceTsx }],
    });
    mockGetSlideSourceRun
      .mockResolvedValueOnce({
        slide: { sourceTsx, revision: 4, sourceHash: "e".repeat(64) },
      })
      .mockResolvedValueOnce({
        slide: { sourceTsx, revision: 5, sourceHash },
      });
    mockUpdateSlideSourceRun.mockResolvedValue({
      revision: 5,
      sourceHash,
    });

    await expect(
      action.run({
        prompt: "A brand hero image",
        deckId: "deck-1",
        slideId: "slide-1",
        generatedImageUrl: "https://cdn.example.com/generated.png",
        insertIntoSlide: true,
      }),
    ).rejects.toThrow("could not be verified");
    expect(mockUpdateSlideRun).not.toHaveBeenCalled();
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
