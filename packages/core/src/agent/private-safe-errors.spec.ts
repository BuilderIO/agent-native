import { describe, expect, it } from "vitest";

import { privateSafeErrorDetail } from "./private-safe-errors.js";

const RESUME_FAILED =
  "I stopped because this turn's private steps could not be safely resumed, so I could not confirm whether an earlier step already finished. Check what was saved before sending the request again.";

describe("privateSafeErrorDetail", () => {
  it("returns the fixed detail for each private-safe code", () => {
    expect(privateSafeErrorDetail("private_history_unrecoverable")).toBe(
      RESUME_FAILED,
    );
    expect(privateSafeErrorDetail("tool_call_journal_unreadable")).toBe(
      RESUME_FAILED,
    );
  });

  it("has no detail for other codes or non-strings", () => {
    expect(privateSafeErrorDetail("provider_specific_code")).toBeUndefined();
    expect(privateSafeErrorDetail("toString")).toBeUndefined();
    expect(privateSafeErrorDetail(undefined)).toBeUndefined();
    expect(privateSafeErrorDetail(42)).toBeUndefined();
  });
});
