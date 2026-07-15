import { describe, expect, it } from "vitest";

import { hasManageableFeatureFlags } from "./helpers.js";

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
