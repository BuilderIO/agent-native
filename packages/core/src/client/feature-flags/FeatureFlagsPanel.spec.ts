import { describe, expect, it } from "vitest";

import {
  hasManageableFeatureFlags,
  normalizeFeatureFlagRules,
} from "./helpers.js";

const flag = {
  key: "beta",
  defaultValue: false,
  rules: { mode: "off" as const, emails: [], orgIds: [], percentage: 0 },
};

describe("hasManageableFeatureFlags", () => {
  it("requires both registered flags and permission", () => {
    expect(hasManageableFeatureFlags(undefined)).toBe(false);
    expect(hasManageableFeatureFlags({ canManage: false, flags: [flag] })).toBe(
      false,
    );
    expect(hasManageableFeatureFlags({ canManage: true, flags: [] })).toBe(
      false,
    );
    expect(hasManageableFeatureFlags({ canManage: true, flags: [flag] })).toBe(
      true,
    );
  });
});

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
});
