import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getAvailableGoogleDocsAccessToken: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >();
  return {
    ...actual,
    getRequestUserEmail: (...args: unknown[]) =>
      mocks.getRequestUserEmail(...args),
  };
});

vi.mock("../server/lib/google-docs-access.js", () => ({
  getAvailableGoogleDocsAccessToken: (...args: unknown[]) =>
    mocks.getAvailableGoogleDocsAccessToken(...args),
}));

import { extractGoogleSlidesUrls } from "../shared/google-docs";
import {
  extractGoogleSlidesPresentationId,
  googleSlidesExportError,
  googleSlidesMeasurementToEmu,
} from "./import-google-slides-reference";
import action from "./import-google-slides-reference";

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

describe("import-google-slides-reference action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.getAvailableGoogleDocsAccessToken.mockResolvedValue(null);
  });

  it("reports a missing Google connection as a safe precondition failure", async () => {
    await expect(
      action.run({ fileId: "presentation_123" }),
    ).rejects.toMatchObject({
      errorCode: "google_drive_not_connected",
      statusCode: 412,
      message: expect.stringContaining("Connect Google button in Slides"),
    });
    expect(mocks.getAvailableGoogleDocsAccessToken).toHaveBeenCalledWith(
      "user@example.com",
      undefined,
    );
  });
});
