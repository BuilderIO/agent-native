import { describe, expect, it } from "vitest";

import {
  formatDesignTokenValue,
  getCssColorToken,
} from "./design-system-preview";

describe("design-system preview helpers", () => {
  it("formats responsive token objects instead of rendering raw objects", () => {
    expect(
      formatDesignTokenValue({
        sm: "14px",
        md: "16px",
        lg: "18px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "30px",
        "4xl": "36px",
        "5xl": "48px",
      }),
    ).toBe(
      "Sm: 14px, Md: 16px, Lg: 18px, Xl: 20px, 2xl: 24px, 3xl: 30px, 4xl: 36px, 5xl: 48px",
    );
  });

  it("uses only strings as CSS color preview values", () => {
    expect(getCssColorToken({ base: "#111827", hover: "#1f2937" })).toBe(
      "#111827",
    );
    expect(getCssColorToken({ sm: { nested: true } })).toBeUndefined();
  });
});
