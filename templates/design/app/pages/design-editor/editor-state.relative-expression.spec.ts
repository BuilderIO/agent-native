import { describe, expect, it } from "vitest";

import { applyRelativeExpressionToStyleValue } from "./editor-state";

describe("applyRelativeExpressionToStyleValue", () => {
  it("evaluates Mixed math against each target's own value and unit", () => {
    const expression = { expression: "Mixed+100", unit: "px" };

    expect(applyRelativeExpressionToStyleValue("10px", expression)).toBe(
      "110px",
    );
    expect(applyRelativeExpressionToStyleValue("24px", expression)).toBe(
      "124px",
    );
  });

  it("keeps constraints and skips values that are not numeric", () => {
    expect(
      applyRelativeExpressionToStyleValue("4", {
        expression: "Mixed^2",
        min: 0,
        max: 100,
        precision: 0,
      }),
    ).toBe("16");
    expect(
      applyRelativeExpressionToStyleValue("auto", {
        expression: "Mixed+5",
      }),
    ).toBeNull();
  });
});
