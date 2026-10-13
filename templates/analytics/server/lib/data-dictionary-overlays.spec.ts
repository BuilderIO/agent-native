import { describe, expect, it } from "vitest";
import { mergeDataDictionaryEntry } from "./data-dictionary-overlays.js";

describe("data dictionary overlays", () => {
  it("preserves generated source-index freshness over stored overlay values", () => {
    const generated = {
      id: "generated-monthly-members",
      sourceIndex: true,
      sourceIndexStale: true,
      sourceIndexAgeDays: 90,
      sourceIndexStaleAfterDays: 30,
      sourceIndexGeneratedAt: "2000-01-01T00:00:00.000Z",
    };
    const overlay = {
      id: generated.id,
      approved: true,
      sourceIndexStale: false,
      sourceIndexAgeDays: 0,
      sourceIndexStaleAfterDays: 36_500,
    };

    expect(mergeDataDictionaryEntry(generated, overlay)).toMatchObject({
      approved: true,
      sourceIndex: true,
      sourceIndexStale: true,
      sourceIndexAgeDays: 90,
      sourceIndexStaleAfterDays: 30,
      sourceIndexGeneratedAt: "2000-01-01T00:00:00.000Z",
    });
  });
});
