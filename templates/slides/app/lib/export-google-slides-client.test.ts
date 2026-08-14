// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildDeckPptxBlobMock } = vi.hoisted(() => ({
  buildDeckPptxBlobMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "/slides",
}));

vi.mock("./export-pptx-client", () => ({
  buildDeckPptxBlob: buildDeckPptxBlobMock,
}));

import { exportDeckToGoogleSlides } from "./export-google-slides-client";

beforeEach(() => {
  vi.clearAllMocks();
  buildDeckPptxBlobMock.mockResolvedValue({
    blob: new Blob(["pptx"]),
    filename: "quarterly-review.pptx",
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        code: "google-not-connected",
        error: "No connected Google account.",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportDeckToGoogleSlides", () => {
  it("returns a connection requirement without downloading a fallback PPTX", async () => {
    await expect(
      exportDeckToGoogleSlides("Quarterly Review", [{ id: "slide-1" }]),
    ).resolves.toEqual({
      url: null,
      requiresConnection: true,
      reason: "No connected Google account.",
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/slides/api/exports/google-slides",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
