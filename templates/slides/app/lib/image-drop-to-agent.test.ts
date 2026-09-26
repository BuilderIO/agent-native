import { describe, expect, it } from "vitest";

import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../../shared/upload-types";
import {
  buildImageDropAgentPayload,
  canInlineImageDataUrl,
  canInlineImageFile,
  isStorageSetupRequiredError,
  isMissingUploadProviderError,
} from "./image-drop-to-agent";

describe("inline image size boundary", () => {
  it("keeps inline bytes below the core request limit", () => {
    expect(
      canInlineImageFile(
        new File([new Uint8Array(749_000)], "small.png", {
          type: "image/png",
        }),
      ),
    ).toBe(true);
    expect(
      canInlineImageFile(
        new File([new Uint8Array(750_000)], "large.png", {
          type: "image/png",
        }),
      ),
    ).toBe(false);
    expect(
      canInlineImageDataUrl(
        `data:image/png;base64,${"a".repeat(MAX_INLINE_IMAGE_BASE64_CHARS)}`,
      ),
    ).toBe(false);
    expect(
      canInlineImageFile(
        new File(["<svg />"], "logo.svg", { type: "image/svg+xml" }),
      ),
    ).toBe(false);
    expect(canInlineImageDataUrl("data:image/svg+xml;base64,abc")).toBe(false);
    expect(canInlineImageDataUrl("data:image/svg+xml ;base64,abc")).toBe(false);
  });
});

describe("isMissingUploadProviderError", () => {
  it("does not treat an unrelated 503 as missing provider", () => {
    expect(
      isMissingUploadProviderError(503, "Private file storage failed."),
    ).toBe(false);
  });

  it("recognizes missing storage even when the endpoint returns 503", () => {
    expect(
      isMissingUploadProviderError(
        503,
        "No object storage is connected. Connect Builder.io (free) or configure your own S3-compatible storage keys.",
      ),
    ).toBe(true);
  });

  it("matches the assets upload error copy", () => {
    expect(
      isMissingUploadProviderError(
        400,
        "No file upload provider is configured. Connect Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads.",
      ),
    ).toBe(true);
  });

  it("recognizes the object-storage API error for localized client handling", () => {
    expect(
      isStorageSetupRequiredError(
        new Error(
          "No object storage is connected. Connect Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads.",
        ),
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
    const dataUrl = "data:image/jpeg;base64,abc";
    const payload = buildImageDropAgentPayload({
      intent: "place it to the right of the text on this slide.",
      filename: "prd meme.jpg",
      upload: {
        ok: true,
        status: 200,
        url: "https://cdn.example.com/prd-meme.jpg",
      },
      dataUrl,
    });

    expect(payload.kind).toBe("hosted");
    if (payload.kind !== "hosted") return;
    expect(payload.referenceImagePaths).toEqual([
      "https://cdn.example.com/prd-meme.jpg",
    ]);
    expect(payload.images).toEqual([dataUrl]);
    expect(payload.message).toBe(
      "place it to the right of the text on this slide.",
    );
    expect(payload.context).toContain(
      "Image URL (already uploaded): https://cdn.example.com/prd-meme.jpg",
    );
    expect(payload.context).toContain("Filename: prd meme.jpg");
    expect(payload.context).toContain(
      "original image is also attached for visual inspection",
    );
    expect(payload.context).not.toContain(
      "place it to the right of the text on this slide.",
    );
  });

  it("keeps hosted-only payloads for oversized uploads", () => {
    const payload = buildImageDropAgentPayload({
      intent: "use this image",
      filename: "large.png",
      upload: {
        ok: true,
        status: 200,
        url: "https://cdn.example.com/large.png",
      },
      dataUrl: `data:image/png;base64,${"a".repeat(MAX_INLINE_IMAGE_BASE64_CHARS)}`,
    });

    expect(payload.kind).toBe("hosted");
    if (payload.kind !== "hosted") return;
    expect(payload.referenceImagePaths).toEqual([
      "https://cdn.example.com/large.png",
    ]);
    expect(payload.images).toBeUndefined();
    expect(payload.context).not.toContain("original image is also attached");
  });

  it("blocks image submission when no storage provider is configured", () => {
    const dataUrl = "data:image/jpeg;base64,abc";
    expect(() =>
      buildImageDropAgentPayload({
        intent: "place it to the right of the text on this slide.",
        filename: "prd meme.jpg",
        upload: {
          ok: false,
          status: 503,
          error:
            "No object storage is connected. Connect Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads.",
        },
        dataUrl,
      }),
    ).toThrow(/No object storage is connected/);
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
