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
});
