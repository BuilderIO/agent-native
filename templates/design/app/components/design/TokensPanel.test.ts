import { describe, expect, it } from "vitest";

import { isColorValue, normalizeCssVarName } from "./TokensPanel";

describe("isColorValue", () => {
  it("accepts valid hex color lengths (#rgb, #rgba, #rrggbb, #rrggbbaa)", () => {
    expect(isColorValue("#fff")).toBe(true);
    expect(isColorValue("#ffff")).toBe(true);
    expect(isColorValue("#3B82F6")).toBe(true);
    expect(isColorValue("#3B82F6FF")).toBe(true);
  });

  it("rejects malformed hex lengths instead of matching them as colors", () => {
    // A bare `{3,8}` digit-count range (the original regex) incorrectly
    // matched 5- and 7-digit hex strings, which aren't valid CSS colors and
    // render as a blank swatch instead of falling back to the type icon.
    expect(isColorValue("#12345")).toBe(false);
    expect(isColorValue("#1234567")).toBe(false);
  });

  it("still accepts rgba/hsla/oklch/color() functional forms", () => {
    expect(isColorValue("rgba(59, 130, 246, 1)")).toBe(true);
    expect(isColorValue("hsl(217 91% 60%)")).toBe(true);
    expect(isColorValue("oklch(0.6 0.15 240)")).toBe(true);
    expect(isColorValue("color(display-p3 0.1 0.2 0.3)")).toBe(true);
  });

  it("rejects non-color token values", () => {
    expect(isColorValue("0.75rem")).toBe(false);
    expect(isColorValue("Inter, sans-serif")).toBe(false);
  });
});

describe("normalizeCssVarName", () => {
  it("adds a -- prefix when missing", () => {
    expect(normalizeCssVarName("my-token")).toBe("--my-token");
  });

  it("leaves an already-prefixed name untouched", () => {
    expect(normalizeCssVarName("--my-token")).toBe("--my-token");
  });

  it("trims surrounding whitespace before checking the prefix", () => {
    // Regression: trimming after the startsWith("--") check meant a leading
    // space (e.g. pasted input) produced a doubled, server-rejected name
    // like "-- --foo" instead of "--foo".
    expect(normalizeCssVarName("  --foo  ")).toBe("--foo");
    expect(normalizeCssVarName("  foo  ")).toBe("--foo");
  });
});
