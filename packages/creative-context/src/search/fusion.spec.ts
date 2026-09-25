import { describe, expect, it } from "vitest";

import { reciprocalRankFusion } from "./fusion.js";

describe("reciprocalRankFusion", () => {
  it("rewards agreement across lexical and visual lanes", () => {
    const result = reciprocalRankFusion({
      lexical: [
        { key: "lexical-only", value: 1, score: 1 },
        { key: "shared", value: 2, score: 0.8, reason: "phrase" },
      ],
      vector: [
        { key: "shared", value: 2, score: 0.95, reason: "visual match" },
        { key: "vector-only", value: 3, score: 0.9 },
      ],
    });
    expect(result[0]?.key).toBe("shared");
    expect(result[0]?.laneRanks).toEqual({ lexical: 2, vector: 1 });
    expect(result[0]?.reasons).toEqual(["phrase", "visual match"]);
  });
});
