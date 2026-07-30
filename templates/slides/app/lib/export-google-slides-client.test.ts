// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDeckPptxBlob: vi.fn(),
  appBasePath: vi.fn(() => ""),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: mocks.appBasePath,
}));
vi.mock("./export-pptx-client", () => ({
  buildDeckPptxBlob: mocks.buildDeckPptxBlob,
}));

import { exportDeckToGoogleSlides } from "./export-google-slides-client";

describe("exportDeckToGoogleSlides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDeckPptxBlob.mockResolvedValue({
      blob: new Blob(["pptx"]),
      filename: "deck.pptx",
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the native Google Slides URL when Drive conversion succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ url: "https://slides.google/deck" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      exportDeckToGoogleSlides("Deck", [{ id: "slide-1" }], "16:9"),
    ).resolves.toEqual({ url: "https://slides.google/deck" });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("downloads the browser-generated PPTX when the upload request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      exportDeckToGoogleSlides("Deck", [{ id: "slide-1" }], "16:9"),
    ).resolves.toMatchObject({
      url: null,
      downloaded: true,
      reason: "offline",
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });
});
