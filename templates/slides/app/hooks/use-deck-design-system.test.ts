import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESIGN_SYSTEM,
  mergeDesignSystemData,
} from "./use-deck-design-system";

describe("mergeDesignSystemData", () => {
  it("fills missing nested design-system tokens with defaults", () => {
    const merged = mergeDesignSystemData({
      colors: { accent: "#ff00aa" },
      typography: { headingFont: "Inter" },
      customCSS: ".slide { color: red; }",
    });

    expect(merged.colors.accent).toBe("#ff00aa");
    expect(merged.colors.text).toBe(DEFAULT_DESIGN_SYSTEM.colors.text);
    expect(merged.typography.headingFont).toBe("Inter");
    expect(merged.typography.bodyFont).toBe(
      DEFAULT_DESIGN_SYSTEM.typography.bodyFont,
    );
    expect(merged.borders.radius).toBe(DEFAULT_DESIGN_SYSTEM.borders.radius);
    expect(merged.borders.accentWidth).toBe(
      DEFAULT_DESIGN_SYSTEM.borders.accentWidth,
    );
    expect(merged.customCSS).toBe(".slide { color: red; }");
  });

  it("uses the default object shape when the stored value is malformed", () => {
    const merged = mergeDesignSystemData({
      colors: "not an object",
      borders: null,
      logos: "not an array",
    });

    expect(merged.colors).toEqual(DEFAULT_DESIGN_SYSTEM.colors);
    expect(merged.borders).toEqual(DEFAULT_DESIGN_SYSTEM.borders);
    expect(merged.logos).toEqual([]);
  });
});
