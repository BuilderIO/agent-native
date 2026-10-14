import { describe, expect, it } from "vitest";

import { assertNativeRecordingMedia } from "./native-media";

describe("assertNativeRecordingMedia", () => {
  it("refuses a screenshot", () => {
    // The video edit actions rewrite editsJson in their own shape, which
    // would drop the marker that keeps a mid-burn screenshot hidden.
    expect(() => assertNativeRecordingMedia({ kind: "image" })).toThrow(
      /Screenshots are edited in the screenshot editor/,
    );
  });

  it("allows a Clips-hosted video", () => {
    expect(() =>
      assertNativeRecordingMedia({
        kind: "video",
        videoUrl: "https://store.example/clip.webm",
      }),
    ).not.toThrow();
  });
});
