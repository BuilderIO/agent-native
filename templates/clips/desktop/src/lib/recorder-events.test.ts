import { describe, expect, it } from "vitest";

import {
  parseRecorderStopPayload,
  recorderStopPayloadTargetsRecording,
} from "./recorder-events";

describe("recorder stop target matching", () => {
  it("accepts only a tagged stop for the published capture identity", () => {
    const stop = parseRecorderStopPayload({ recordingId: "recording-1" });

    expect(recorderStopPayloadTargetsRecording(stop, "recording-1")).toBe(true);
    expect(recorderStopPayloadTargetsRecording(stop, "recording-2")).toBe(
      false,
    );
    expect(recorderStopPayloadTargetsRecording(stop, null)).toBe(false);
  });
});
