import { describe, expect, it } from "vitest";

import {
  STALE_RECORDING_UPLOAD_MS,
  isLiveRecordingUpload,
  isStaleRecordingUpload,
} from "./recording-status";

describe("recording upload status helpers", () => {
  const now = Date.parse("2026-07-01T12:00:00.000Z");

  it("keeps recent uploading recordings live", () => {
    const recording = {
      status: "uploading",
      updatedAt: new Date(now - 60_000).toISOString(),
    };

    expect(isLiveRecordingUpload(recording, now)).toBe(true);
    expect(isStaleRecordingUpload(recording, now)).toBe(false);
  });

  it("marks old non-ready uploads as stale", () => {
    const recording = {
      status: "processing",
      updatedAt: new Date(now - STALE_RECORDING_UPLOAD_MS).toISOString(),
    };

    expect(isLiveRecordingUpload(recording, now)).toBe(false);
    expect(isStaleRecordingUpload(recording, now)).toBe(true);
  });

  it("does not classify failed or ready recordings as stale uploads", () => {
    const updatedAt = new Date(now - STALE_RECORDING_UPLOAD_MS).toISOString();

    expect(isStaleRecordingUpload({ status: "failed", updatedAt }, now)).toBe(
      false,
    );
    expect(isStaleRecordingUpload({ status: "ready", updatedAt }, now)).toBe(
      false,
    );
  });
});
