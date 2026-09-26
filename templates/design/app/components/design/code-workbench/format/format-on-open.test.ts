import { describe, expect, it } from "vitest";

import { shouldApplyFormatResult } from "./format-on-open-guard";

describe("shouldApplyFormatResult", () => {
  it("applies the result when the model is unchanged and formatting differs", () => {
    expect(
      shouldApplyFormatResult("const x=1", "const x=1", "const x = 1;"),
    ).toBe(true);
  });

  it("skips when the formatted output is identical to the snapshot (no-op)", () => {
    expect(
      shouldApplyFormatResult("const x = 1;", "const x = 1;", "const x = 1;"),
    ).toBe(false);
  });

  it("skips when the user edited the buffer while formatting was in flight", () => {
    expect(
      shouldApplyFormatResult(
        "const x=1\nconst y=2",
        "const x=1",
        "const x = 1;",
      ),
    ).toBe(false);
  });
});
