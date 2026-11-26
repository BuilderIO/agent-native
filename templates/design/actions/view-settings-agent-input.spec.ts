import { describe, expect, it } from "vitest";

import action from "./update-view-settings.js";

describe("view settings agent input", () => {
  it("advertises only current settings while accepting legacy client updates", () => {
    const parameters = action.tool.parameters as {
      properties: Record<string, unknown>;
    };

    expect(Object.keys(parameters.properties).sort()).toEqual([
      "commentsHidden",
      "multiplayerCursors",
      "pixelGrid",
      "rulers",
      "snapToPixelGrid",
    ]);
    const legacyPatch = {
      tweaksPanelOpen: false,
      tweaksPanelCollapsed: true,
      tweaksPanelPosition: { x: 32, y: 96 },
    };
    expect(action.schema.parse(legacyPatch)).toEqual(legacyPatch);
  });
});
