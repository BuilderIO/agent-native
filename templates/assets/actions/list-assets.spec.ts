import { describe, expect, it } from "vitest";

import action from "./list-assets.js";

describe("list-assets schema", () => {
  it("allows libraryId to be omitted for cross-kit browsing", () => {
    const parsed = action.schema.parse({
      query: "hero",
    });

    expect(parsed.libraryId).toBeUndefined();
    expect(parsed.query).toBe("hero");
  });

  it("accepts a single GET candidateRunIds value as an array", () => {
    const parsed = action.schema.parse({
      libraryId: "lib-1",
      candidateRunIds: "run-1",
    });

    expect(parsed.candidateRunIds).toEqual(["run-1"]);
  });
});
