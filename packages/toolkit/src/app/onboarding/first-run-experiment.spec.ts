// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  getAnalyticsAnonymousId: vi.fn<() => string | undefined>(),
}));

vi.mock("@agent-native/core/client/analytics", () => analytics);

import {
  assignFirstRunSetupVariant,
  getPreviewFirstRunSetupVariant,
} from "./first-run-experiment.js";

describe("first-run setup experiment", () => {
  beforeEach(() => {
    window.localStorage.clear();
    analytics.getAnalyticsAnonymousId.mockReset();
  });

  it("splits anonymous ids roughly evenly and deterministically", () => {
    const arms = Array.from({ length: 400 }, (_, index) => {
      window.localStorage.clear();
      analytics.getAnalyticsAnonymousId.mockReturnValue(`anon-${index}`);
      return assignFirstRunSetupVariant();
    });
    const credits = arms.filter((arm) => arm === "credits").length;
    expect(credits).toBeGreaterThan(160);
    expect(credits).toBeLessThan(240);

    window.localStorage.clear();
    analytics.getAnalyticsAnonymousId.mockReturnValue("anon-7");
    expect(assignFirstRunSetupVariant()).toBe(arms[7]);
  });

  it("keeps the stored arm even if the anonymous id changes", () => {
    analytics.getAnalyticsAnonymousId.mockReturnValue("anon-1");
    const first = assignFirstRunSetupVariant();
    analytics.getAnalyticsAnonymousId.mockReturnValue("anon-2");
    expect(assignFirstRunSetupVariant()).toBe(first);
  });

  it("does not expose an unmeasurable arm without an anonymous id", () => {
    analytics.getAnalyticsAnonymousId.mockReturnValue(undefined);
    expect(assignFirstRunSetupVariant()).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("stays out of the experiment when storage cannot hold the arm", () => {
    analytics.getAnalyticsAnonymousId.mockReturnValue("anon-1");
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    const blocked = (failing: "getItem" | "setItem") => {
      const fake = {
        getItem: () => {
          if (failing === "getItem") throw new Error("blocked");
          return null;
        },
        setItem: () => {
          if (failing === "setItem") throw new Error("blocked");
        },
      };
      Object.defineProperty(window, "localStorage", {
        value: fake,
        configurable: true,
      });
    };
    try {
      blocked("setItem");
      expect(assignFirstRunSetupVariant()).toBeNull();
      blocked("getItem");
      expect(assignFirstRunSetupVariant()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("pins a preview arm from the query string only for known arms", () => {
    expect(getPreviewFirstRunSetupVariant("?variant=credits")).toBe("credits");
    expect(getPreviewFirstRunSetupVariant("?variant=control")).toBe("control");
    expect(getPreviewFirstRunSetupVariant("?variant=nope")).toBeNull();
  });
});
