import { describe, expect, it } from "vitest";

import { resolveThumbnailPickerState } from "./thumbnail-picker-state";

describe("resolveThumbnailPickerState", () => {
  it("restores a saved frame selection", () => {
    expect(
      resolveThumbnailPickerState(
        { kind: "frame", value: "12500" },
        { durationMs: 20_000 },
      ),
    ).toMatchObject({ tab: "frame", frameTime: 12_500 });
  });

  it("restores and bounds a saved GIF selection", () => {
    expect(
      resolveThumbnailPickerState(
        {
          kind: "gif",
          value: JSON.stringify({ startMs: 18_000, durationMs: 4_000 }),
        },
        { durationMs: 20_000 },
      ),
    ).toMatchObject({ tab: "gif", gifStart: 16_000, gifDuration: 4_000 });
  });

  it("falls back safely for malformed persisted values", () => {
    expect(
      resolveThumbnailPickerState(
        { kind: "gif", value: "not-json" },
        { durationMs: 20_000 },
      ),
    ).toMatchObject({ tab: "gif", gifStart: 0, gifDuration: 3_000 });
  });

  it("opens the GIF tab for legacy animated thumbnails without a spec", () => {
    expect(
      resolveThumbnailPickerState(null, {
        durationMs: 20_000,
        hasAnimatedThumbnail: true,
      }),
    ).toMatchObject({ tab: "gif" });
  });
});
