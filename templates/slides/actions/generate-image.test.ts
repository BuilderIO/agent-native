import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDelegateImageGenerationToAssets,
  mockGetProvider,
  mockGenerate,
  mockFetchReferenceImages,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockGetProvider: vi.fn(),
  mockGenerate: vi.fn(),
  mockFetchReferenceImages: vi.fn(),
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
  fetchReferenceImages: (...args: unknown[]) =>
    mockFetchReferenceImages(...args),
}));

import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";
import main from "./generate-image.js";

describe("generate-image CLI", () => {
  let originalExitCode: string | number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelegateImageGenerationToAssets.mockReset();
    mockGenerate.mockReset();
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

  it("rejects when all local variations fail", async () => {
    mockGenerate.mockRejectedValue(new Error("provider unavailable"));

    await expect(
      main(["--prompt", "a hero image", "--count", "2"]),
    ).rejects.toThrow("No image variations were generated successfully.");

    expect(process.exitCode).toBe(0);
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
    mockFetchReferenceImages.mockResolvedValue({
      requested: 1,
      attempted: 1,
      loaded: 1,
      failed: 0,
      skipped: 0,
      totalBytes: Buffer.byteLength("image bytes"),
      images: [
        {
          data: Buffer.from("image bytes").toString("base64"),
          mimeType: "image/webp",
          byteLength: Buffer.byteLength("image bytes"),
        },
      ],
      failures: [],
      skippedReasons: [],
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

    expect(mockFetchReferenceImages).toHaveBeenCalledWith(
      ["https://cdn.example.com/reference.webp"],
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
    mockFetchReferenceImages.mockResolvedValue({
      requested: 1,
      attempted: 1,
      loaded: 0,
      failed: 1,
      skipped: 0,
      totalBytes: 0,
      images: [],
      failures: [
        {
          index: 1,
          reason: {
            code: "unsupported_content_type",
            contentType: "text/html",
          },
        },
      ],
      skippedReasons: [],
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

  it("reports references skipped by a batch limit", async () => {
    mockFetchReferenceImages.mockResolvedValue({
      requested: 10,
      attempted: 8,
      loaded: 8,
      failed: 0,
      skipped: 2,
      totalBytes: 8,
      images: Array.from({ length: 8 }, () => ({
        data: Buffer.from("i").toString("base64"),
        mimeType: "image/png",
        byteLength: 1,
      })),
      failures: [],
      skippedReasons: [
        { code: "reference_count_limit", count: 2, maxReferences: 8 },
      ],
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
      Array.from(
        { length: 10 },
        (_, index) => `https://cdn.example.com/${index}.png`,
      ).join(","),
    ]);

    expect(console.warn).toHaveBeenCalledWith(
      "Skipped 2 reference image(s) after the 8-image limit.",
    );
    expect(console.log).toHaveBeenCalledWith(
      "Loaded 8 of 10 reference image(s) for style matching; 0 failed, 2 skipped (8 bytes loaded).",
    );
  });

  it("fails instead of falling back when Assets has no unavailability reason", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "unavailable",
      reason: "  ",
    });

    await expect(
      main(["--prompt", "a brand hero image", "--use-brand-library", "true"]),
    ).rejects.toThrow(
      "Assets reported image generation unavailable without a reason",
    );

    expect(process.exitCode).toBe(0);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Assets reported image generation unavailable without a reason; local fallback skipped.",
    );
  });

  it("rejects when Assets is still generating instead of exiting successfully", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "pending",
      taskId: "task-1",
      lastState: "running",
    });

    await expect(
      main(["--prompt", "a brand hero image", "--use-brand-library", "true"]),
    ).rejects.toThrow(/Assets is still generating/);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it("rejects when Assets reports a failed generation", async () => {
    mockDelegateImageGenerationToAssets.mockResolvedValue({
      status: "rejected",
      state: "failed",
      reason: "provider failure",
    });

    await expect(
      main(["--prompt", "a brand hero image", "--use-brand-library", "true"]),
    ).rejects.toThrow(
      "Assets could not generate this image (failed): provider failure",
    );
    expect(mockGetProvider).not.toHaveBeenCalled();
  });
});
