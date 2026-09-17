import { describe, expect, it } from "vitest";

import {
  PLAN_SHARE_REF,
  PLAN_SHARE_SURFACE,
  readPlanShareAttribution,
  withPlanShareAttribution,
} from "./share-attribution";

describe("plan share attribution contract", () => {
  it("uses the contract strings", () => {
    expect(PLAN_SHARE_REF).toBe("plan_share");
    expect(PLAN_SHARE_SURFACE).toBe("plan");
  });

  describe("withPlanShareAttribution", () => {
    it("appends ref=plan_share and via=<ownerId>", () => {
      const out = withPlanShareAttribution(
        "https://plan.example.com/plans/abc",
        "user_123",
      );
      const url = new URL(out as string);
      expect(url.searchParams.get("ref")).toBe("plan_share");
      expect(url.searchParams.get("via")).toBe("user_123");
    });

    it("omits via when no owner id is available (never leaks PII)", () => {
      const out = withPlanShareAttribution(
        "https://plan.example.com/plans/abc",
      );
      const url = new URL(out as string);
      expect(url.searchParams.get("ref")).toBe("plan_share");
      expect(url.searchParams.has("via")).toBe(false);
    });

    it("omits via for blank/whitespace owner ids", () => {
      const out = withPlanShareAttribution(
        "https://plan.example.com/plans/abc",
        "   ",
      );
      expect(new URL(out as string).searchParams.has("via")).toBe(false);
    });

    it("preserves existing query params", () => {
      const out = withPlanShareAttribution(
        "https://plan.example.com/plans/abc?tab=design",
        "user_123",
      );
      const url = new URL(out as string);
      expect(url.searchParams.get("tab")).toBe("design");
      expect(url.searchParams.get("ref")).toBe("plan_share");
    });

    it("returns the input unchanged for non-absolute URLs", () => {
      expect(withPlanShareAttribution("/plans/abc", "user_123")).toBe(
        "/plans/abc",
      );
      expect(withPlanShareAttribution(undefined)).toBeUndefined();
    });
  });

  describe("readPlanShareAttribution", () => {
    it("reads ref/via from a query string", () => {
      const { ref, via } = readPlanShareAttribution("?ref=plan_share&via=u_1");
      expect(ref).toBe("plan_share");
      expect(via).toBe("u_1");
    });

    it("defaults ref to plan_share and via to undefined when absent", () => {
      const { ref, via } = readPlanShareAttribution("");
      expect(ref).toBe("plan_share");
      expect(via).toBeUndefined();
    });

    it("never throws on malformed input", () => {
      expect(() => readPlanShareAttribution("%%%not-a-query%%%")).not.toThrow();
    });
  });
});
