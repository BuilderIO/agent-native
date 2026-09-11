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
      ]),
    );
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
