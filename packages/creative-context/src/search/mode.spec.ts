import { describe, expect, it } from "vitest";

import { matchesCreativeSearchMode, shouldUsePostgresFts } from "./mode.js";

describe("creative context search-mode routing", () => {
  it("keeps safe regex evaluation in the portable lane", () => {
    expect(shouldUsePostgresFts("regex")).toBe(false);
    expect(shouldUsePostgresFts("phrase")).toBe(true);
    expect(shouldUsePostgresFts("allTerms")).toBe(true);
  });

  it("preserves punctuation when matching an exact phrase", () => {
    expect(
      matchesCreativeSearchMode(
        "literal 100%_match value",
        "100%_match",
        "phrase",
      ),
    ).toBe(true);
    expect(
      matchesCreativeSearchMode(
        "needle middle alpha",
        "needle alpha",
        "phrase",
      ),
    ).toBe(false);
  });
});
