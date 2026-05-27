import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIBRARY_PRESETS,
  getLibraryPreset,
} from "./library-presets.js";

describe("default library presets", () => {
  it("keeps preset ids unique and resolvable", () => {
    const ids = DEFAULT_LIBRARY_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(getLibraryPreset(id)?.id).toBe(id);
    }
  });

  it("does not expose named studio imitation as a preset", () => {
    const searchable = JSON.stringify(DEFAULT_LIBRARY_PRESETS).toLowerCase();

    expect(searchable).not.toContain("airbnb");
    expect(searchable).not.toContain("ghibli");
    expect(searchable).not.toContain("miyazaki");
    expect(searchable).not.toContain("airbnb-esque");
    expect(searchable).not.toContain("studio ghibli style");
  });
});
