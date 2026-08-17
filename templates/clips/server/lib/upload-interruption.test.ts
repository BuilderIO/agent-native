import { describe, expect, it } from "vitest";

import {
  isRetryableUploadInterruption,
  RETRYABLE_UPLOAD_INTERRUPTION_REASON,
  retryableUploadInterruptionReason,
} from "./upload-interruption.js";

describe("retryable upload interruption reasons", () => {
  it("keeps the bare reason recognizable", () => {
    expect(retryableUploadInterruptionReason(null)).toBe(
      RETRYABLE_UPLOAD_INTERRUPTION_REASON,
    );
    expect(retryableUploadInterruptionReason("   ")).toBe(
      RETRYABLE_UPLOAD_INTERRUPTION_REASON,
    );
    expect(
      isRetryableUploadInterruption(RETRYABLE_UPLOAD_INTERRUPTION_REASON),
    ).toBe(true);
  });

  it("stays retryable once it carries a diagnosis", () => {
    const reason = retryableUploadInterruptionReason(
      "Clip may be incomplete. The local media duration (405467 ms) did not match the recorded duration (422551 ms).",
    );
    expect(reason).toContain(RETRYABLE_UPLOAD_INTERRUPTION_REASON);
    expect(reason).toContain("405467 ms");
    expect(isRetryableUploadInterruption(reason)).toBe(true);
  });

  it("stays within the failure-reason column budget", () => {
    const reason = retryableUploadInterruptionReason("x".repeat(5000));
    expect(reason.length).toBe(1000);
  });

  it("does not treat unrelated failures as retryable", () => {
    expect(isRetryableUploadInterruption("Upload aborted by user")).toBe(false);
    expect(isRetryableUploadInterruption(null)).toBe(false);
    expect(isRetryableUploadInterruption(undefined)).toBe(false);
    // A reason that merely starts with similar words must not slip through.
    expect(isRetryableUploadInterruption("Upload was interrupted.")).toBe(
      false,
    );
  });
});
