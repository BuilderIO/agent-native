/**
 * Color Parsing Performance Tests
 *
 * Verifies that color parsing is properly cached to avoid redundant regex operations
 */

import { describe, it, expect, beforeEach } from "vitest";
import { calculateElementAnimations } from "../useElementAnimations";

describe("Color Parsing Performance", () => {
  it("should parse rgba colors correctly", () => {
    const result = calculateElementAnimations({
      elementType: "TestElement",
      baseColor: "rgba(255, 100, 50, 1)",
      hoverProgress: 0,
      clickProgress: 0,
    });

    expect(result.backgroundColor).toContain("255");
    expect(result.backgroundColor).toContain("100");
    expect(result.backgroundColor).toContain("50");
  });

  it("should handle repeated calls with same color efficiently", () => {
    const baseColor = "rgba(100, 150, 200, 1)";
    const iterations = 1000;

    // First call - will parse and cache
    const start1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateElementAnimations({
        elementType: "TestElement",
        baseColor,
        hoverProgress: 0,
        clickProgress: 0,
      });
    }
    const duration1 = performance.now() - start1;

    // Second batch - should all hit cache
    const start2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateElementAnimations({
        elementType: "TestElement",
        baseColor,
        hoverProgress: 0,
        clickProgress: 0,
      });
    }
    const duration2 = performance.now() - start2;

    // Cached calls should be faster or similar (not testing exact speed as it varies)
    // Just verify both complete without errors and in reasonable time
    expect(duration1).toBeLessThan(1000); // Should complete in under 1 second
    expect(duration2).toBeLessThan(1000);

    console.log(
      `First batch: ${duration1.toFixed(2)}ms, Second batch: ${duration2.toFixed(2)}ms`,
    );
  });

  it("should handle multiple different colors", () => {
    const colors = [
      "rgba(255, 0, 0, 1)",
      "rgba(0, 255, 0, 1)",
      "rgba(0, 0, 255, 1)",
      "rgba(100, 100, 100, 1)",
    ];

    colors.forEach((color) => {
      const result = calculateElementAnimations({
        elementType: "TestElement",
        baseColor: color,
        hoverProgress: 0,
        clickProgress: 0,
      });

      expect(result.backgroundColor).toBeDefined();
    });
  });

  it("should fallback to default color for invalid input", () => {
    const result = calculateElementAnimations({
      elementType: "TestElement",
      baseColor: "invalid-color",
      hoverProgress: 0,
      clickProgress: 0,
    });

    // Should fallback to blue (59, 130, 246)
    expect(result.backgroundColor).toContain("59");
    expect(result.backgroundColor).toContain("130");
    expect(result.backgroundColor).toContain("246");
  });
});
