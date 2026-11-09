import { describe, expect, it } from "vitest";

import {
  DESIGN_TEMPLATE_PRESETS,
  presetFiles,
} from "./design-template-presets.js";
import { countLockedLayers } from "./locked-layers.js";

describe("Design template presets", () => {
  it("ships the requested sized starter formats with fixed brand layers", () => {
    expect(
      DESIGN_TEMPLATE_PRESETS.map((preset) => [
        preset.category,
        preset.width,
        preset.height,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["social", 1080, 1080],
        ["ad", 1200, 628],
        ["one-pager", 816, 1056],
        ["landing-page", 1440, 1024],
        ["landing-page", 1440, 2464],
        ["social", 1080, 1920],
        ["presentation", 1920, 1080],
        ["other", 1200, 1600],
      ]),
    );
    expect(
      new Set(DESIGN_TEMPLATE_PRESETS.map((preset) => preset.id)).size,
    ).toBe(DESIGN_TEMPLATE_PRESETS.length);
    expect(
      DESIGN_TEMPLATE_PRESETS.slice(-4).map((preset) => preset.id),
    ).toEqual([
      "preset-social-square",
      "preset-display-ad",
      "preset-one-pager",
      "preset-landing-page",
    ]);
    for (const file of DESIGN_TEMPLATE_PRESETS.flatMap(presetFiles)) {
      expect(countLockedLayers(file.content)).toBe(2);
      expect(file.content).toMatch(
        /data-agent-native-node-id="template-background"[^>]*style=|style="[^"]*"[^>]*data-agent-native-node-id="template-background"/,
      );
      expect(file.content).toMatch(
        /data-agent-native-node-id="template-logo"[^>]*style=|style="[^"]*"[^>]*data-agent-native-node-id="template-logo"/,
      );
    }
  });
  it("leads with the four app-screen starters the home library shows first", () => {
    expect(
      DESIGN_TEMPLATE_PRESETS.slice(0, 4).map((preset) => preset.id),
    ).toEqual([
      "preset-analytics-dashboard",
      "preset-messaging-app",
      "preset-project-tasks",
      "preset-design-studio",
    ]);
    for (const preset of DESIGN_TEMPLATE_PRESETS.slice(0, 4)) {
      expect([preset.width, preset.height]).toEqual([1440, 900]);
      expect(preset.description).not.toMatch(/\n/);
      expect(preset.description.length).toBeLessThanOrEqual(60);
    }
  });

  it("spaces multi-frame presets so canvas labels stay readable", () => {
    for (const preset of DESIGN_TEMPLATE_PRESETS) {
      const files = presetFiles(preset);
      expect(new Set(files.map((file) => file.id)).size).toBe(files.length);
      for (const [i, a] of files.entries()) {
        for (const b of files.slice(i + 1)) {
          // Frame labels sit above each frame, so stacked frames need more room.
          const apart =
            a.x + a.width + 120 <= b.x ||
            b.x + b.width + 120 <= a.x ||
            a.y + a.height + 240 <= b.y ||
            b.y + b.height + 240 <= a.y;
          expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
        }
      }
    }
  });
});
