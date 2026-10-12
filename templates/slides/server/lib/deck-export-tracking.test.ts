import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackSlides: vi.fn() }));

vi.mock("./slides-tracking.js", () => ({
  trackSlides: (...args: unknown[]) => mocks.trackSlides(...args),
}));

import {
  asPptxDownloadRegeneration,
  trackDeckExported,
  withExportFailureTracking,
} from "./deck-export-tracking.js";

describe("PPTX download regeneration tracking", () => {
  beforeEach(() => {
    mocks.trackSlides.mockReset();
  });

  it("does not record a second export when an authenticated link is regenerated", async () => {
    const regenerate = withExportFailureTracking<{ deckId: string }>("pptx")(
      async () => {
        trackDeckExported(
          {
            deckId: "deck-1",
            exportFormat: "pptx",
            renderLocation: "server",
            status: "completed",
            slideCount: 1,
          },
          { caller: "http" },
        );
        throw new Error("render failed");
      },
    );

    await expect(
      asPptxDownloadRegeneration(() =>
        regenerate({ deckId: "deck-1" }, { caller: "http" }),
      ),
    ).rejects.toThrow("render failed");

    expect(mocks.trackSlides).not.toHaveBeenCalled();
  });

  it("records a normal server export", () => {
    trackDeckExported({
      deckId: "deck-1",
      exportFormat: "pptx",
      renderLocation: "server",
      status: "completed",
      slideCount: 1,
    });

    expect(mocks.trackSlides).toHaveBeenCalledTimes(1);
    expect(mocks.trackSlides.mock.calls[0][1]).toMatchObject({
      export_format: "pptx",
      output_id: "deck-1",
      status: "completed",
    });
  });
});
