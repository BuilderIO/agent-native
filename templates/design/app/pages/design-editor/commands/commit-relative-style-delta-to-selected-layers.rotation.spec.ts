import { describe, expect, it } from "vitest";

import { applyRelativeRotationToTransform } from "./commit-relative-style-delta-to-selected-layers";

describe("applyRelativeRotationToTransform", () => {
  it("applies deltas in Figma's counter-clockwise-positive domain", () => {
    expect(
      applyRelativeRotationToTransform(
        "translateX(10px) rotate(-10deg) scale(2)",
        15,
      ),
    ).toBe("translateX(10px) rotate(-25deg) scale(2)");
  });

  it("applies Mixed math in each target's displayed degree domain", () => {
    expect(
      applyRelativeRotationToTransform(
        "translateY(20px) rotate(-30deg) scale(0.5)",
        { expression: "Mixed+15", unit: "deg" },
      ),
    ).toBe("translateY(20px) rotate(-45deg) scale(0.5)");
  });

  it("applies a typed absolute value while preserving each target's transform", () => {
    expect(
      applyRelativeRotationToTransform(
        "translateX(10px) rotate(-10deg) scale(2)",
        { expression: "Mixed*0+45", unit: "deg" },
      ),
    ).toBe("translateX(10px) rotate(-45deg) scale(2)");
  });

  it("preserves non-rotation functions when appending a rotation", () => {
    expect(
      applyRelativeRotationToTransform("scale(2) translateY(20px)", {
        expression: "Mixed+15",
        unit: "deg",
      }),
    ).toBe("scale(2) translateY(20px) rotate(-15deg)");
    expect(
      applyRelativeRotationToTransform(undefined, {
        expression: "Mixed-15",
        unit: "deg",
      }),
    ).toBe("rotate(15deg)");
  });
});
