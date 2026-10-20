import { describe, expect, it } from "vitest";

import {
  failBurn,
  getBurnProgress,
  startBurn,
} from "./redaction-burn-progress";

describe("redaction burn progress failures", () => {
  it("preserves a typed failure code for the polling UI", () => {
    const recordingId = "rec_storage_setup_error";
    startBurn(recordingId);
    failBurn(recordingId, "Storage setup required", "storage_setup_required");

    expect(getBurnProgress(recordingId)).toEqual({
      status: "failed",
      percent: 0,
      error: "Storage setup required",
      errorCode: "storage_setup_required",
    });
  });
});
