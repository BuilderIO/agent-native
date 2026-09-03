import { describe, expect, it } from "vitest";

import {
  allFrameSizePresets,
  FRAME_SIZE_PRESET_CATEGORIES,
} from "./frame-size-presets";

describe("frame size presets", () => {
  it("has at least one category with at least one preset each", () => {
    expect(FRAME_SIZE_PRESET_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of FRAME_SIZE_PRESET_CATEGORIES) {
      expect(category.presets.length).toBeGreaterThan(0);
    }
  });

  it("puts Phone first so it is the default-expanded group", () => {
    expect(FRAME_SIZE_PRESET_CATEGORIES[0]?.key).toBe("phone");
  });

  it("has no duplicate category keys", () => {
    const keys = FRAME_SIZE_PRESET_CATEGORIES.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has no duplicate preset names across the entire list", () => {
    const names = allFrameSizePresets().map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only contains positive integer widths and heights", () => {
    for (const preset of allFrameSizePresets()) {
      expect(Number.isInteger(preset.width)).toBe(true);
      expect(Number.isInteger(preset.height)).toBe(true);
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
    }
  });

  it("gives every preset a non-empty name", () => {
    for (const preset of allFrameSizePresets()) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
    }
  });

  // Paper presets share this canvas's 96dpi-CSS-px unit convention (every
  // other category — phone/tablet/desktop/social — is already in px), not
  // Figma's 72dpi point values. A point-valued "Letter"/"A4" preset would
  // author a canvas ~25% smaller than the real physical page once run
  // through createSinglePageRasterPdf's px->pt conversion.
  it("sizes Letter and A4 paper presets in 96dpi px, not 72dpi pt", () => {
    const paper = FRAME_SIZE_PRESET_CATEGORIES.find((c) => c.key === "paper");
    const letter = paper?.presets.find((p) => p.name === "Letter");
    const a4 = paper?.presets.find((p) => p.name === "A4");
    expect(letter).toEqual({ name: "Letter", width: 816, height: 1056 });
    expect(a4).toEqual({ name: "A4", width: 794, height: 1123 });
  });

  it("offers the standard IAB ad-unit sizes for non-web ad design", () => {
    const adUnit = FRAME_SIZE_PRESET_CATEGORIES.find((c) => c.key === "adUnit");
    const dims = new Set(adUnit?.presets.map((p) => `${p.width}x${p.height}`));
    expect(dims).toEqual(
      new Set(["300x250", "728x90", "160x600", "320x50", "970x250"]),
    );
  });
});
