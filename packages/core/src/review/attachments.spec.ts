import { describe, expect, it, vi } from "vitest";

const getActiveFileUploadProviderForRequest = vi.hoisted(() => vi.fn());

vi.mock("../file-upload/registry.js", () => ({
  getActiveFileUploadProviderForRequest,
}));

const { sanitizeReviewCommentMetadata } = await import("./attachments.js");

describe("review comment attachment metadata", () => {
  it("keeps only image URLs owned by the active provider", async () => {
    const isOwnedUrl = vi.fn(async (url: string) =>
      url.startsWith("https://uploads.example.com/"),
    );
    getActiveFileUploadProviderForRequest.mockResolvedValue({
      id: "s3",
      isOwnedUrl,
    });

    await expect(
      sanitizeReviewCommentMetadata({
        severity: "high",
        attachments: [
          {
            url: "https://uploads.example.com/review.png",
            name: "Review",
            contentType: "image/png",
            provider: "s3",
          },
          {
            url: "https://tracker.example/pixel",
            name: "Tracker",
            contentType: "image/png",
          },
          {
            url: "https://uploads.example.com/document.pdf",
            name: "Document",
            contentType: "application/pdf",
            provider: "s3",
          },
          {
            url: "https://uploads.example.com/wrong-provider.png",
            name: "Wrong provider",
            contentType: "image/png",
            provider: "builder",
          },
        ],
      }),
    ).resolves.toEqual({
      severity: "high",
      attachments: [
        {
          url: "https://uploads.example.com/review.png",
          name: "Review",
          contentType: "image/png",
          provider: "s3",
        },
      ],
    });
  });

  it("retains legacy Builder CDN images without trusting arbitrary hosts", async () => {
    getActiveFileUploadProviderForRequest.mockResolvedValue(null);

    await expect(
      sanitizeReviewCommentMetadata({
        attachments: [
          {
            url: "https://cdn.builder.io/image.png",
            name: "Builder image",
          },
          {
            url: "https://tracker.example/pixel",
            name: "Tracker",
          },
        ],
      }),
    ).resolves.toEqual({
      attachments: [
        { url: "https://cdn.builder.io/image.png", name: "Builder image" },
      ],
    });
  });

  it("preserves the five-image composer limit while dropping additional images", async () => {
    const isOwnedUrl = vi.fn(async () => true);
    getActiveFileUploadProviderForRequest.mockResolvedValue({
      id: "s3",
      isOwnedUrl,
    });

    const attachments = Array.from({ length: 6 }, (_, index) => ({
      url: `https://uploads.example.com/review-${index + 1}.png`,
      name: `Review ${index + 1}`,
      contentType: "image/png",
      provider: "s3",
    }));

    await expect(
      sanitizeReviewCommentMetadata({ attachments }),
    ).resolves.toEqual({ attachments: attachments.slice(0, 5) });
  });
});
