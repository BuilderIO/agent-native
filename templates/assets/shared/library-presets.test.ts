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

  it("ships local reference images with attribution metadata", () => {
    for (const preset of DEFAULT_LIBRARY_PRESETS) {
      expect(preset.referenceImages.length).toBeGreaterThanOrEqual(3);

      const referenceIds = preset.referenceImages.map(
        (reference) => reference.id,
      );
      expect(new Set(referenceIds).size).toBe(referenceIds.length);

      for (const reference of preset.referenceImages) {
        expect(reference.path).toMatch(
          new RegExp(`^/library-presets/${preset.id}/.+\\.webp$`),
        );
        expect(reference.sourceUrl).toMatch(/^https:\/\//);
        expect(reference.downloadUrl).toMatch(/^https:\/\//);
        expect(reference.author).toBeTruthy();
        expect(reference.licenseName).toBeTruthy();
        expect(reference.licenseUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it("does not expose named studio imitation as a preset", () => {
    const searchable = JSON.stringify(
      DEFAULT_LIBRARY_PRESETS.map((preset) => ({
        title: preset.title,
        description: preset.description,
        styleBrief: preset.styleBrief,
        customInstructions: preset.customInstructions,
        samplePrompts: preset.samplePrompts,
      })),
    ).toLowerCase();

    expect(searchable).not.toContain("airbnb");
    expect(searchable).not.toContain("ghibli");
    expect(searchable).not.toContain("miyazaki");
    expect(searchable).not.toContain("airbnb-esque");
    expect(searchable).not.toContain("studio ghibli style");
  });
});
