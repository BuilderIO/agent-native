import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import {
  normalizeRecordingPlatform,
  trackRecordingFailure,
} from "./recording-failures.js";

describe("recording failure analytics", () => {
  beforeEach(() => mockTrack.mockClear());

  it("normalizes unknown platforms and correlates failure to the attempt", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      uploadAttemptId: "attempt_1",
      platform: "future-client",
      failureCode: "finalize_failed",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.objectContaining({
        recording_attempt_id: "rec_1",
        upload_attempt_id: "attempt_1",
        recording_platform: "unknown",
        failure_code: "finalize_failed",
      }),
    );
    expect(mockTrack.mock.calls[0]).toHaveLength(2);
  });

  it("accepts only the normalized platform vocabulary", () => {
    expect(normalizeRecordingPlatform("extension")).toBe("extension");
    expect(normalizeRecordingPlatform("Chrome")).toBe("unknown");
  });

  it("records cancellation separately from recording failures", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      platform: "web",
      failureCode: "user_cancelled",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_cancelled",
      expect.objectContaining({ failure_code: "user_cancelled" }),
    );
  });
});
