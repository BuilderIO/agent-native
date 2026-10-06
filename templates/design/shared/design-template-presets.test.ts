import { describe, expect, it } from "vitest";

import { DESIGN_TEMPLATE_PRESETS } from "./design-template-presets.js";
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
    for (const preset of DESIGN_TEMPLATE_PRESETS) {
      expect(countLockedLayers(preset.content)).toBe(2);
      expect(preset.content).toMatch(
        /data-agent-native-node-id="template-background"[^>]*style=|style="[^"]*"[^>]*data-agent-native-node-id="template-background"/,
      );
      expect(preset.content).toMatch(
        /data-agent-native-node-id="template-logo"[^>]*style=|style="[^"]*"[^>]*data-agent-native-node-id="template-logo"/,
      );
    }
  });
});
