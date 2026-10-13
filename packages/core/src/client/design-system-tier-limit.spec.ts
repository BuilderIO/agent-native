import { describe, expect, it } from "vitest";

import {
  DESIGN_SYSTEM_TIER_LIMIT_ERROR_CODE,
  isDesignSystemCodeIndexingAllowed,
  isDesignSystemTierAtMax,
  readDesignSystemTierLimitFailure,
  type DesignSystemTierLimit,
} from "./design-system-tier-limit.js";

function tierLimit(
  overrides: Partial<DesignSystemTierLimit> = {},
): DesignSystemTierLimit {
  return {
    status: "ok",
    plan: "free",
    current: 0,
    max: 1,
    atMax: false,
    codeIndexingAllowed: false,
    upgradeUrl: null,
    ...overrides,
  };
}

describe("isDesignSystemTierAtMax", () => {
  it("is false until the lookup resolves, then reflects atMax", () => {
    expect(isDesignSystemTierAtMax(undefined)).toBe(false);
    expect(isDesignSystemTierAtMax(tierLimit({ status: "unavailable" }))).toBe(
      false,
    );
    expect(isDesignSystemTierAtMax(tierLimit({ atMax: true }))).toBe(true);
  });
});

describe("isDesignSystemCodeIndexingAllowed", () => {
  it("fails closed while the lookup is unresolved or unavailable, even if a stale value says allowed", () => {
    expect(isDesignSystemCodeIndexingAllowed(undefined)).toBe(false);
    expect(
      isDesignSystemCodeIndexingAllowed(
        tierLimit({ status: "unavailable", codeIndexingAllowed: true }),
      ),
    ).toBe(false);
  });

  it("allows code indexing only once the plan is confirmed to permit it", () => {
    expect(
      isDesignSystemCodeIndexingAllowed(
        tierLimit({ plan: "enterprise", codeIndexingAllowed: true }),
      ),
    ).toBe(true);
    expect(
      isDesignSystemCodeIndexingAllowed(
        tierLimit({ plan: "pro", codeIndexingAllowed: false }),
      ),
    ).toBe(false);
  });
});

describe("readDesignSystemTierLimitFailure", () => {
  it("recovers plan/current/max/upgradeUrl from a 402's error details", () => {
    const error = Object.assign(
      new Error("You have reached your design system limit"),
      {
        errorCode: DESIGN_SYSTEM_TIER_LIMIT_ERROR_CODE,
        details: {
          plan: "pro",
          current: 3,
          max: 3,
          upgradeUrl: "https://builder.io/account/subscription",
        },
      },
    );

    expect(readDesignSystemTierLimitFailure(error, "fallback")).toEqual({
      message: "You have reached your design system limit",
      plan: "pro",
      current: 3,
      max: 3,
      upgradeUrl: "https://builder.io/account/subscription",
    });
  });
});
