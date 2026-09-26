import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
const mockGetRequestContext = vi.hoisted(() =>
  vi.fn(() => undefined as { authUserId?: string } | undefined),
);

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => mockGetRequestContext(),
}));

import {
  normalizeRecordingPlatform,
  trackRecordingFailure,
} from "./recording-failures.js";

describe("recording failure analytics", () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockGetRequestContext.mockReturnValue(undefined);
  });

  it("adds the verified Better Auth id without inferring it from the email", () => {
    mockGetRequestContext.mockReturnValue({
      authUserId: "better-auth-user-1",
    });

    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "finalize_failed",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.any(Object),
      { userId: "owner@example.com", authUserId: "better-auth-user-1" },
    );
  });

  it("uses stored canonical identity for background failures without request context", () => {
    trackRecordingFailure({
      recordingId: "rec_background",
      userId: "owner@example.com",
      authUserId: "stored-auth-user",
      uploadAttemptId: "upload-attempt-1",
      platform: "desktop",
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
      httpStatus: 502,
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.objectContaining({
        recording_attempt_id: "rec_background",
        upload_attempt_id: "upload-attempt-1",
        recording_platform: "desktop",
        failure_code: "chunk_html_error",
        failure_stage: "chunk_upload",
        http_status: 502,
      }),
      { userId: "owner@example.com", authUserId: "stored-auth-user" },
    );
  });

  it("normalizes unknown platforms and correlates failure to the attempt", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
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
      { userId: "owner@example.com" },
    );
    expect(mockTrack.mock.calls[0][2]).toEqual({ userId: "owner@example.com" });
  });

  it("accepts only the normalized platform vocabulary", () => {
    expect(normalizeRecordingPlatform("extension")).toBe("extension");
    expect(normalizeRecordingPlatform("Chrome")).toBe("unknown");
  });

  it("tracks normalized stage and status for an HTML chunk error", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
      httpStatus: 502,
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.objectContaining({
        failure_code: "chunk_html_error",
        failure_stage: "chunk_upload",
        http_status: 502,
      }),
      { userId: "owner@example.com" },
    );
  });

  it("records cancellation separately from recording failures", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "user_cancelled",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_cancelled",
      expect.objectContaining({ failure_code: "user_cancelled" }),
      { userId: "owner@example.com" },
    );
  });

  it("records retryable upload interruption separately from terminal failure", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      uploadAttemptId: "attempt_1",
      platform: "desktop",
      failureCode: "upload_interrupted",
      failureStage: "upload_interrupt",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_upload_interrupted",
      expect.objectContaining({
        recording_attempt_id: "rec_1",
        upload_attempt_id: "attempt_1",
        failure_code: "upload_interrupted",
        failure_stage: "upload_interrupt",
      }),
      { userId: "owner@example.com" },
    );
  });
});
