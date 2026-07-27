import { describe, expect, it } from "vitest";

import {
  buildImageDropAgentPayload,
  isMissingUploadProviderError,
} from "./image-drop-to-agent";

describe("isMissingUploadProviderError", () => {
  it("treats 503 as missing provider", () => {
    expect(isMissingUploadProviderError(503, undefined)).toBe(true);
  });

  it("matches the assets upload error copy", () => {
    expect(
      isMissingUploadProviderError(
        400,
        "No file upload provider is configured. Connect Builder.io from the agent composer model menu, or register a custom provider via registerFileUploadProvider().",
      ),
    ).toBe(true);
  });

  it("does not match unrelated upload errors", () => {
    expect(
      isMissingUploadProviderError(400, "File too large (max 10 MB)"),
    ).toBe(false);
  });
});

describe("buildImageDropAgentPayload", () => {
  it("uses a hosted URL when upload succeeds", () => {
    const payload = buildImageDropAgentPayload({
      intent: "place it to the right of the text on this slide.",
      filename: "prd meme.jpg",
      upload: {
        ok: true,
        status: 200,
        url: "https://cdn.example.com/prd-meme.jpg",
      },
    });

    expect(payload.kind).toBe("hosted");
    if (payload.kind !== "hosted") return;
    expect(payload.referenceImagePaths).toEqual([
      "https://cdn.example.com/prd-meme.jpg",
    ]);
    expect(payload.message).toContain(
      "Image URL (already uploaded): https://cdn.example.com/prd-meme.jpg",
    );
    expect(payload.message).toContain(
      "place it to the right of the text on this slide.",
    );
  });

  it("falls back to an inline data URL when no provider is configured", () => {
    const dataUrl = "data:image/jpeg;base64,abc";
    const payload = buildImageDropAgentPayload({
      intent: "place it to the right of the text on this slide.",
      filename: "prd meme.jpg",
      upload: {
        ok: false,
        status: 503,
        error:
          "No file upload provider is configured. Connect Builder.io from the agent composer model menu, or register a custom provider via registerFileUploadProvider().",
      },
      dataUrl,
    });

    expect(payload.kind).toBe("inline");
    if (payload.kind !== "inline") return;
    expect(payload.images).toEqual([dataUrl]);
    expect(payload.message).toContain("upload-image");
    expect(payload.message).not.toContain("Image URL (already uploaded)");
  });

  it("throws when upload fails and no data URL is available", () => {
    expect(() =>
      buildImageDropAgentPayload({
        intent: "",
        filename: "x.png",
        upload: {
          ok: false,
          status: 503,
          error: "No file upload provider is configured.",
        },
      }),
    ).toThrow(/No file upload provider/);
  });
});
