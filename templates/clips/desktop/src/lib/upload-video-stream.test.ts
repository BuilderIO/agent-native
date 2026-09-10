import { describe, expect, it } from "vitest";

import { shouldResampleVideoForUpload } from "./upload-video-stream";

describe("desktop upload video stream", () => {
  it("passes through sources already within the long-edge budget", () => {
    expect(
      shouldResampleVideoForUpload({ width: 1920, height: 1080 }, 1920),
    ).toBe(false);
    expect(
      shouldResampleVideoForUpload({ width: 1280, height: 830 }, 1920),
    ).toBe(false);
  });

  it("resamples oversized or unknown sources", () => {
    expect(
      shouldResampleVideoForUpload({ width: 2560, height: 1440 }, 1920),
    ).toBe(true);
    expect(
      shouldResampleVideoForUpload({ width: null, height: 1080 }, 1920),
    ).toBe(true);
  });
});
