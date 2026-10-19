import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDelegateImageGenerationToAssets,
  mockGetProvider,
  mockGenerate,
  mockFetchReferenceImage,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockGetProvider: vi.fn(),
  mockGenerate: vi.fn(),
  mockFetchReferenceImage: vi.fn(),
}));

vi.mock("../server/lib/assets-image-delegation.js", () => ({
  delegateImageGenerationToAssets: (...args: unknown[]) =>
    mockDelegateImageGenerationToAssets(...args),
  extractAssetUrl: vi.fn(),
  extractAssetUrls: vi.fn(),
  imagePreviewMarkdown: vi.fn(),
  stripHtml: (html: string) => html.replace(/<[^>]*>/g, " ").trim(),
}));

vi.mock("../server/handlers/image-providers/index.js", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}));

vi.mock("../server/lib/reference-image-fetch.js", () => ({
  fetchReferenceImage: (...args: unknown[]) => mockFetchReferenceImage(...args),
}));

import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";
import main from "./generate-image.js";

describe("generate-image CLI", () => {
  let originalExitCode: string | number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelegateImageGenerationToAssets.mockReset();
    mockGenerate.mockReset();
    mockFetchReferenceImage.mockReset();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    DEFAULT_STYLE_REFERENCE_URLS.splice(0, DEFAULT_STYLE_REFERENCE_URLS.length);
    mockGetProvider.mockResolvedValue({ generate: mockGenerate });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode ?? 0;
  });

  it("sets a failing exit status when all local variations fail", async () => {
    mockGenerate.mockRejectedValue(new Error("provider unavailable"));

    await main(["--prompt", "a hero image", "--count", "2"]);

    expect(process.exitCode).toBe(1);
    expect(mockDelegateImageGenerationToAssets).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "No image variations were generated successfully.",
    );
    expect(console.log).not.toHaveBeenCalledWith("\nDone!");
  });

  it("keeps a successful exit status when at least one variation succeeds", async () => {
    mockGenerate
      .mockRejectedValueOnce(new Error("one variation failed"))
      .mockResolvedValueOnce({
        imageData: Buffer.from("image"),
        mimeType: "image/png",
        model: "gemini",
        provider: "gemini",
      });

    await main(["--prompt", "a hero image", "--count", "2"]);

    expect(process.exitCode).toBe(0);
    expect(console.log).toHaveBeenCalledWith("\nDone!");
  });

  it("uses SSRF-safe HTTPS fetches and only forwards image references", async () => {
    mockFetchReferenceImage.mockResolvedValue({
      ok: true,
      image: {
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/webp",
      },
    });
    mockGenerate.mockResolvedValue({
      imageData: Buffer.from("image"),
      mimeType: "image/png",
      model: "gemini",
      provider: "gemini",
    });

    await main([
      "--prompt",
      "a hero image",
      "--reference-image-urls",
      "https://cdn.example.com/reference.webp",
    ]);

    expect(mockFetchReferenceImage).toHaveBeenCalledWith(
      "https://cdn.example.com/reference.webp",
      { timeoutMs: 8_000 },
    );
    expect(mockGenerate).toHaveBeenCalledWith(
      "a hero image",
      [
        {
          data: Buffer.from("image bytes").toString("base64"),
          mimeType: "image/webp",
        },
      ],
      undefined,
    );
  });

  it("does not send non-image reference bodies to the provider", async () => {
    mockFetchReferenceImage.mockResolvedValue({
      ok: false,
      reason: { code: "unsupported_content_type", contentType: "text/html" },
    });
    mockGenerate.mockResolvedValue({
      imageData: Buffer.from("image"),
      mimeType: "image/png",
      model: "gemini",
      provider: "gemini",
    });

    await main([
      "--prompt",
      "a hero image",
      "--reference-image-urls",
      "https://cdn.example.com/page",
    ]);

    expect(mockGenerate).toHaveBeenCalledWith("a hero image", [], undefined);
    expect(console.warn).toHaveBeenCalledWith(
      'Reference image 1 was not loaded ({"code":"unsupported_content_type","contentType":"text/html"}).',
    );
  });

  it("fails instead of falling back when Assets has no unavailability reason", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "  ",
    });

    await main([
      "--prompt",
      "a brand hero image",
      "--use-brand-library",
      "true",
    ]);

    expect(process.exitCode).toBe(1);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Assets reported image generation unavailable without a reason; local fallback skipped.",
    );
  });
});
