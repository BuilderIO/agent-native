import { describe, expect, it } from "vitest";

import { keywordTokens } from "./lanes.js";

describe("keywordTokens", () => {
  it("gives a word's inflections one token", () => {
    const tokens = ["charge", "charges", "charged", "charging"].map((word) =>
      keywordTokens(word),
    );
    expect(new Set(tokens.flat()).size).toBe(1);
    expect(keywordTokens("All duplicate charges were refunded")).toEqual(
      expect.arrayContaining(keywordTokens("charged")),
    );
  });

  it("drops question words and filler", () => {
    expect(keywordTokens("What document shows our Q3 hiring plan")).toEqual(
      keywordTokens("document shows q3 hiring plan"),
    );
  });
});
