import { describe, expect, it } from "vitest";

import {
  describeFrameFailure,
  frameFailureStatus,
} from "./agent-frame-request.js";
import { RecordingMediaFetchError } from "./recording-media-fetch-error.js";

describe("frame request failures", () => {
  it("suggests smaller requests when the range request budget is exceeded", () => {
    const error = new RecordingMediaFetchError(
      "Recording range request budget exceeded.",
      413,
    );
    expect(frameFailureStatus(error)).toBe(413);
    expect(describeFrameFailure(error, 413)).toMatchObject({
      failureKind: "processing",
      error: "Recording range request budget exceeded.",
      nextStep: expect.stringContaining("shorter frame-sheet range"),
    });
    expect(describeFrameFailure(error, 413).nextStep).toContain(
      "individual frames",
    );
  });
});
