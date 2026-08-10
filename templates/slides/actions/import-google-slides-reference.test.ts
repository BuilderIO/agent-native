import { describe, expect, it } from "vitest";

import {
  extractGoogleSlidesPresentationId,
  googleSlidesExportError,
  googleSlidesMeasurementToEmu,
} from "./import-google-slides-reference";

describe("extractGoogleSlidesPresentationId", () => {
  it("accepts a Google Slides URL with a slide anchor", () => {
    expect(
      extractGoogleSlidesPresentationId(
        "https://docs.google.com/presentation/d/presentation_123/edit?slide=id.1#slide=id.1",
      ),
    ).toBe("presentation_123");
  });

  it("continues to accept picker file IDs", () => {
    expect(extractGoogleSlidesPresentationId("presentation_123")).toBe(
      "presentation_123",
    );
  });

  it("rejects non-Slides URLs", () => {
    expect(() =>
      extractGoogleSlidesPresentationId(
        "https://docs.google.com/document/d/doc_1/edit",
      ),
    ).toThrow("not a Google Slides presentation link");
  });

  it("converts Google point measurements while preserving EMU responses", () => {
    expect(googleSlidesMeasurementToEmu(72, "PT")).toBe(914_400);
    expect(googleSlidesMeasurementToEmu(914_400, "EMU")).toBe(914_400);
    expect(googleSlidesMeasurementToEmu(undefined, "PT")).toBeUndefined();
  });

  it("turns Google export access failures into actionable client errors", () => {
    const error = googleSlidesExportError(403);

    expect(error.statusCode).toBe(403);
    expect(error.message).toContain("Connect Google again");
    expect(error.message).toContain("Google Picker");
  });
});
