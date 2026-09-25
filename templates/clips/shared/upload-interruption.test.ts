import { describe, expect, it } from "vitest";

import {
  RETRYABLE_UPLOAD_INTERRUPTION_REASON,
  isRetryableUploadInterruption,
  retryableUploadInterruptionReason,
} from "./upload-interruption";

describe("upload interruption retryability", () => {
  it("recognizes the base interruption reason and its detailed form", () => {
    expect(
      isRetryableUploadInterruption(RETRYABLE_UPLOAD_INTERRUPTION_REASON),
    ).toBe(true);
    expect(
      isRetryableUploadInterruption(
        retryableUploadInterruptionReason("Network connection lost"),
      ),
    ).toBe(true);
  });

  it("rejects permanent and unrelated failure reasons", () => {
    expect(
      isRetryableUploadInterruption("File storage is not configured."),
    ).toBe(false);
    expect(isRetryableUploadInterruption("Media verification failed.")).toBe(
      false,
    );
    expect(isRetryableUploadInterruption(null)).toBe(false);
  });
});
