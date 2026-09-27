import { describe, expect, it } from "vitest";

import { projectAssetVariationResult } from "./action-ui.js";

describe("projectAssetVariationResult", () => {
  it("projects successful batch images and their prompts for the card", () => {
    expect(
      projectAssetVariationResult(
        {
          slots: [
            { slotId: "one", prompt: "A red fox" },
            { slotId: "two", prompt: "A blue fox" },
          ],
        },
        {
          images: [
            {
              ok: true,
              slotId: "one",
              id: "asset-1",
              libraryId: "library-1",
              title: "Fox one",
              previewUrl: "/api/assets/asset-1/content",
              status: "candidate",
              mimeType: "image/png",
              providerOutput: "not projected",
            },
            {
              ok: false,
              slotId: "two",
              error: "Provider failed",
            },
          ],
        },
      ),
    ).toEqual({
      images: [
        {
          id: "asset-1",
          libraryId: "library-1",
          title: "Fox one",
          previewUrl: "/api/assets/asset-1/content",
          status: "candidate",
          mimeType: "image/png",
          prompt: "A red fox",
        },
      ],
    });
  });

  it("projects a single generated asset and preserves draft approval gating", () => {
    expect(
      projectAssetVariationResult(
        { prompt: "A landscape" },
        {
          id: "asset-2",
          libraryId: "library-1",
          previewUrl: "/api/assets/asset-2/content",
          draftPendingApproval: true,
        },
      ),
    ).toEqual({
      images: [
        {
          id: "asset-2",
          libraryId: "library-1",
          title: null,
          previewUrl: "/api/assets/asset-2/content",
          draftPendingApproval: true,
          prompt: "A landscape",
        },
      ],
    });
  });

  it("omits invalid, failed, and previewless results", () => {
    expect(projectAssetVariationResult({}, { id: "asset-1" })).toBeNull();
    expect(
      projectAssetVariationResult(
        {},
        {
          images: [
            { ok: false, id: "failed", libraryId: "lib", previewUrl: "/x" },
            { id: "no-preview", libraryId: "lib" },
          ],
        },
      ),
    ).toBeNull();
  });

  it("bounds the prompt projected into chat history", () => {
    const prompt = "a".repeat(1_000);
    const result = projectAssetVariationResult(
      { prompt },
      {
        id: "asset-3",
        libraryId: "library-1",
        previewUrl: "/api/assets/asset-3/content",
      },
    );

    expect(result?.images[0]?.prompt).toBe("a".repeat(240));
  });
});
