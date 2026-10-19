import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDelegateImageGenerationToAssets,
  mockGetProvider,
  mockGenerate,
  mockSsrfSafeFetch,
} = vi.hoisted(() => ({
  mockDelegateImageGenerationToAssets: vi.fn(),
  mockGetProvider: vi.fn(),
  mockGenerate: vi.fn(),
  mockSsrfSafeFetch: vi.fn(),
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

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";
import main from "./generate-image.js";

describe("generate-image CLI", () => {
  let originalExitCode: string | number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelegateImageGenerationToAssets.mockReset();
    mockGenerate.mockReset();
    mockSsrfSafeFetch.mockReset();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    DEFAULT_STYLE_REFERENCE_URLS.splice(0, DEFAULT_STYLE_REFERENCE_URLS.length);
    mockGetProvider.mockResolvedValue({ generate: mockGenerate });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("image bytes", {
        headers: { "content-type": "image/webp; charset=binary" },
      }),
    );
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

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://cdn.example.com/reference.webp",
      { signal: expect.any(AbortSignal) },
      { httpsOnly: true, maxRedirects: 2 },
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
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("<html>not an image</html>", {
        headers: { "content-type": "text/html" },
      }),
    );
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
