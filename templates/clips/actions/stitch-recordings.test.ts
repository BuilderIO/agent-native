import { describe, expect, it } from "vitest";

import action from "./stitch-recordings.js";

describe("stitch-recordings schema", () => {
  const sourceRecordingIds = ["recording-one", "recording-two"];

  it("keeps recordingId optional for existing action callers", () => {
    const parsed = action.schema.parse({ sourceRecordingIds });

    expect(parsed.recordingId).toBeUndefined();
  });

  it("accepts a pre-reserved recordingId for recording-bound uploads", () => {
    const parsed = action.schema.parse({
      recordingId: "reserved-recording-id",
      sourceRecordingIds,
    });

    expect(parsed.recordingId).toBe("reserved-recording-id");
  });
});
