import { describe, expect, it } from "vitest";

import {
  normalizeFeatureFlagPercentage,
  normalizeFeatureFlagRules,
} from "./helpers.js";

describe("normalizeFeatureFlagRules", () => {
  it("fills absent collections in transient remote rule envelopes", () => {
    expect(
      normalizeFeatureFlagRules({ mode: "rules", percentage: 50 }),
    ).toMatchObject({
      version: 1,
      mode: "rules",
      emails: [],
      orgIds: [],
      percentage: 50,
    });
  });

  it("clamps invalid percentages without treating an unknown mode as off", () => {
    expect(
      normalizeFeatureFlagRules({ percentage: 125 } as never),
    ).toMatchObject({ mode: "rules", percentage: 100 });
  });

  it("uses the same integer percentage contract as the mutation schemas", () => {
    expect(normalizeFeatureFlagPercentage(12.9)).toBe(12);
    expect(normalizeFeatureFlagPercentage(-1)).toBe(0);
    expect(normalizeFeatureFlagPercentage(101)).toBe(100);
  });
});
