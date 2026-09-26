import { describe, expect, it } from "vitest";

import { resolveGoogleSlidesImportPayload } from "./google-slides-reference-source";

describe("resolveGoogleSlidesImportPayload", () => {
  it("sends a docs.google.com presentation URL as presentationUrl", () => {
    expect(
      resolveGoogleSlidesImportPayload(
        "https://docs.google.com/presentation/d/deck-google/edit",
      ),
    ).toEqual({
      presentationUrl:
        "https://docs.google.com/presentation/d/deck-google/edit",
    });
  });

  it("sends a bare picker file ID as fileId, not presentationUrl", () => {
    expect(resolveGoogleSlidesImportPayload("presentation_123")).toEqual({
      fileId: "presentation_123",
    });
  });

  it("trims surrounding whitespace before classifying the value", () => {
    expect(resolveGoogleSlidesImportPayload("  presentation_123  ")).toEqual({
      fileId: "presentation_123",
    });
  });
});
