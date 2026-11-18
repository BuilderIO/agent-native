import { describe, expect, it } from "vitest";

import {
  normalizeFeatureFlagPercentage,
  normalizeFeatureFlagRules,
} from "./helpers.js";
import type { FeatureFlagRules } from "./types.js";

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

  it("keeps who last changed a stored rule", () => {
    const stored: FeatureFlagRules = {
      mode: "on",
      emails: [],
      orgIds: [],
      percentage: 0,
      updatedAt: 1_700_000_000_000,
      updatedBy: { name: "Ada Admin", email: "ada@example.test" },
    };
    expect(normalizeFeatureFlagRules(stored)).toMatchObject({
      updatedAt: 1_700_000_000_000,
      updatedBy: { name: "Ada Admin", email: "ada@example.test" },
    });
  });

  it("uses the same integer percentage contract as the mutation schemas", () => {
    expect(normalizeFeatureFlagPercentage(12.9)).toBe(12);
    expect(normalizeFeatureFlagPercentage(-1)).toBe(0);
    expect(normalizeFeatureFlagPercentage(101)).toBe(100);
  });
});
