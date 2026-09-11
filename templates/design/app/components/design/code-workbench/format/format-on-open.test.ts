import { describe, expect, it } from "vitest";

// Import the pure guard directly from format-on-open-guard.ts, not from
// format-on-open.ts — the latter also imports `../store` / `../model-registry`
// (and transitively `monaco-editor`), which require a full browser
// environment and can't load under vitest's default node environment. Same
// split used by status-bar-lang.ts for StatusBar.tsx.
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
    // The live model no longer matches the snapshot that was sent to
    // Prettier — applying the stale formatted result would discard the
    // user's in-progress edit.
    expect(
      shouldApplyFormatResult(
        "const x=1\nconst y=2",
        "const x=1",
        "const x = 1;",
      ),
    ).toBe(false);
  });
});
