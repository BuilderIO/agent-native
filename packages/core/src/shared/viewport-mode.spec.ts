import { describe, expect, it } from "vitest";

import { normalizeViewportMode } from "./viewport-mode.js";

describe("normalizeViewportMode", () => {
  it("normalizes foreground and background values with whitespace and mixed case", () => {
    expect(normalizeViewportMode("foreground")).toBe("foreground");
    expect(normalizeViewportMode("background")).toBe("background");
    expect(normalizeViewportMode("  FOREGROUND \t")).toBe("foreground");
    expect(normalizeViewportMode("\n Background ")).toBe("background");
  });

  it("returns undefined for non-strings, empty strings, and unsupported values", () => {
    expect(normalizeViewportMode(undefined)).toBeUndefined();
    expect(normalizeViewportMode(null)).toBeUndefined();
    expect(normalizeViewportMode(123)).toBeUndefined();
    expect(normalizeViewportMode({})).toBeUndefined();
    expect(normalizeViewportMode("")).toBeUndefined();
    expect(normalizeViewportMode("   ")).toBeUndefined();
    expect(normalizeViewportMode("side-by-side")).toBeUndefined();
    expect(normalizeViewportMode("foreground-only")).toBeUndefined();
  });
});
