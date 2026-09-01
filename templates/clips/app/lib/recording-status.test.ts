import { describe, expect, it } from "vitest";

import {
  PROCESSING_AT_RISK_MS,
  STALE_RECORDING_UPLOAD_MS,
  UPLOAD_AT_RISK_MS,
  isAtRiskRecordingUpload,
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

  it("flags an uploading recording as at-risk once it's quiet longer than expected", () => {
    const fresh = {
      status: "uploading",
      updatedAt: new Date(now - 60_000).toISOString(),
    };
    const quiet = {
      status: "uploading",
      updatedAt: new Date(now - UPLOAD_AT_RISK_MS).toISOString(),
    };

    expect(isAtRiskRecordingUpload(fresh, now)).toBe(false);
    expect(isAtRiskRecordingUpload(quiet, now)).toBe(true);
  });

  it("uses a longer at-risk threshold for processing than uploading", () => {
    const quietUploading = {
      status: "processing",
      updatedAt: new Date(now - UPLOAD_AT_RISK_MS).toISOString(),
    };
    const quietProcessing = {
      status: "processing",
      updatedAt: new Date(now - PROCESSING_AT_RISK_MS).toISOString(),
    };

    expect(isAtRiskRecordingUpload(quietUploading, now)).toBe(false);
    expect(isAtRiskRecordingUpload(quietProcessing, now)).toBe(true);
  });

  it("stops calling a recording at-risk once it's already stale", () => {
    const recording = {
      status: "uploading",
      updatedAt: new Date(now - STALE_RECORDING_UPLOAD_MS).toISOString(),
    };

    expect(isStaleRecordingUpload(recording, now)).toBe(true);
    expect(isAtRiskRecordingUpload(recording, now)).toBe(false);
  });

  it("does not flag failed or ready recordings as at-risk", () => {
    const updatedAt = new Date(now - PROCESSING_AT_RISK_MS).toISOString();

    expect(isAtRiskRecordingUpload({ status: "failed", updatedAt }, now)).toBe(
      false,
    );
    expect(isAtRiskRecordingUpload({ status: "ready", updatedAt }, now)).toBe(
      false,
    );
  });
});
