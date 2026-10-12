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

  it("suppresses successful telemetry when an authenticated link is regenerated", async () => {
    await asPptxDownloadRegeneration(async () => {
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
    });

    expect(mocks.trackSlides).not.toHaveBeenCalled();
  });

  it("records failed telemetry when an authenticated link regeneration fails", async () => {
    const regenerate = withExportFailureTracking<{ deckId: string }>("pptx")(
      async () => {
        throw new Error("render failed");
      },
    );

    await expect(
      asPptxDownloadRegeneration(() =>
        regenerate({ deckId: "deck-1" }, { caller: "http" }),
      ),
    ).rejects.toThrow("render failed");

    expect(mocks.trackSlides).toHaveBeenCalledTimes(1);
    expect(mocks.trackSlides.mock.calls[0][0]).toBe("deck_exported");
    expect(mocks.trackSlides.mock.calls[0][1]).toMatchObject({
      export_format: "pptx",
      status: "failed",
      error_type: "export_error",
    });
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
