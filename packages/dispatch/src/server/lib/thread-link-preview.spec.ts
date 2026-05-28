import { describe, expect, it } from "vitest";
import { extractThreadPreviewImageUrl } from "./thread-link-preview";

function threadDataWithResult(toolName: string, result: unknown) {
  return JSON.stringify({
    messages: [
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName,
              result:
                typeof result === "string" ? result : JSON.stringify(result),
            },
          ],
        },
        parentId: null,
      },
    ],
  });
}

describe("thread link preview image extraction", () => {
  it("uses generated image preview URLs from generate-image results", () => {
    expect(
      extractThreadPreviewImageUrl(
        threadDataWithResult("generate-image", {
          url: "https://app.example.com/assets/asset/asset-1",
          previewUrl: "https://cdn.example.com/generated-social.webp",
          thumbnailUrl: "https://cdn.example.com/generated-social-thumb.webp",
        }),
      ),
    ).toBe("https://cdn.example.com/generated-social.webp");
  });

  it("uses the newest image from batched generation results", () => {
    expect(
      extractThreadPreviewImageUrl(
        threadDataWithResult("generate-image-batch", {
          images: [
            { previewUrl: "https://cdn.example.com/first.png" },
            { previewUrl: "https://cdn.example.com/latest.png" },
          ],
        }),
      ),
    ).toBe("https://cdn.example.com/latest.png");
  });

  it("ignores asset page URLs that are not image media", () => {
    expect(
      extractThreadPreviewImageUrl(
        threadDataWithResult("generate-image", {
          url: "https://app.example.com/assets/asset/asset-1",
        }),
      ),
    ).toBeNull();
  });
});
