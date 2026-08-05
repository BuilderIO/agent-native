import { describe, expect, it } from "vitest";

import { shouldCapturePlanContent } from "./plan-tracking";

describe("Plan tracking privacy", () => {
  it.each(["/local-plans", "/local-plans/private-review"])(
    "disables content capture on %s",
    (pathname) => {
      expect(shouldCapturePlanContent(pathname)).toBe(false);
    },
  );

  it("allows content capture on hosted plan routes", () => {
    expect(shouldCapturePlanContent("/plans/plan-123")).toBe(true);
  });
});
