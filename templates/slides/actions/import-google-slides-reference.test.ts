import { describe, expect, it } from "vitest";

import { extractGoogleSlidesUrls } from "../shared/google-docs";
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

  it("accepts account-scoped Google Slides URLs", () => {
    expect(
      extractGoogleSlidesPresentationId(
        "https://docs.google.com/presentation/u/0/d/presentation_123/edit",
      ),
    ).toBe("presentation_123");
  });

  it("continues to accept picker file IDs", () => {
    expect(extractGoogleSlidesPresentationId("presentation_123")).toBe(
      "presentation_123",
    );
  });

  it("extracts Google Slides URLs from text", () => {
    expect(
      extractGoogleSlidesUrls(
        "See https://docs.google.com/presentation/d/presentation_123/edit?slide=id.p1#slide=id.p1, and also https://docs.google.com/presentation/u/0/d/presentation_456/view?usp=sharing.",
      ),
    ).toEqual([
      "https://docs.google.com/presentation/d/presentation_123/edit?slide=id.p1#slide=id.p1",
      "https://docs.google.com/presentation/u/0/d/presentation_456/view?usp=sharing",
    ]);
  });

  it("ignores Docs and arbitrary URLs", () => {
    expect(
      extractGoogleSlidesUrls(
        "https://docs.google.com/document/d/doc_1/edit https://example.com/presentation/d/presentation_123/edit",
      ),
    ).toEqual([]);
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
