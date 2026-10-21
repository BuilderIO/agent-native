import { overviewFocusNavigationIndex } from "@shared/overview-navigation";
import { describe, expect, it } from "vitest";

describe("overviewFocusNavigationIndex", () => {
  it("moves focus across and between grid rows", () => {
    expect(overviewFocusNavigationIndex(0, 8, "ArrowRight", 4)).toBe(1);
    expect(overviewFocusNavigationIndex(2, 8, "ArrowDown", 4)).toBe(6);
    expect(overviewFocusNavigationIndex(6, 8, "ArrowUp", 4)).toBe(2);
    expect(overviewFocusNavigationIndex(1, 8, "ArrowLeft", 4)).toBe(0);
  });

  it("clamps focus at the first and last slide boundaries", () => {
    expect(overviewFocusNavigationIndex(0, 4, "ArrowUp", 2)).toBe(0);
    expect(overviewFocusNavigationIndex(3, 4, "ArrowDown", 2)).toBe(3);
    expect(overviewFocusNavigationIndex(0, 4, "ArrowLeft", 2)).toBe(0);
    expect(overviewFocusNavigationIndex(3, 4, "ArrowRight", 2)).toBe(3);
  });

  it("supports Home and End and ignores unsupported keys or invalid inputs", () => {
    expect(overviewFocusNavigationIndex(2, 4, "Home", 2)).toBe(0);
    expect(overviewFocusNavigationIndex(1, 4, "End", 2)).toBe(3);
    expect(overviewFocusNavigationIndex(1, 4, "Enter", 2)).toBeNull();
    expect(overviewFocusNavigationIndex(-1, 4, "ArrowDown", 2)).toBeNull();
    expect(overviewFocusNavigationIndex(4, 4, "ArrowUp", 2)).toBeNull();
    expect(overviewFocusNavigationIndex(0, 4, "ArrowDown", 0)).toBeNull();
  });
});
