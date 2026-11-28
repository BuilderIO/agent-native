import { describe, expect, it, vi } from "vitest";

import {
  cleanupAfterFrameFailure,
  describeFrameFailure,
  frameFailureStatus,
} from "./agent-frame-request.js";
import { RecordingMediaFetchError } from "./recording-media-fetch-error.js";

describe("frame request failures", () => {
  it("logs a safe cleanup code without exposing paths or arbitrary error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await cleanupAfterFrameFailure(async () => {
        throw Object.assign(new Error("private path"), { code: "EACCES" });
      });
      await cleanupAfterFrameFailure(async () => {
        throw Object.assign(new Error("private path"), {
          code: "private data",
        });
      });
      expect(log.mock.calls).toEqual([
        ["[agent-frame] Media cleanup failed.", "EACCES"],
        ["[agent-frame] Media cleanup failed.", "UNKNOWN"],
      ]);
    } finally {
      log.mockRestore();
    }
  });

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
