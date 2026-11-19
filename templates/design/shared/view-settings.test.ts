import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_SETTINGS,
  parseStoredViewSettings,
} from "./view-settings";

describe("parseStoredViewSettings", () => {
  it("returns the defaults for a user who never saved anything", () => {
    expect(parseStoredViewSettings(null)).toEqual(DEFAULT_VIEW_SETTINGS);
  });

  it("keeps saved values and defaults the rest", () => {
    expect(parseStoredViewSettings({ rulers: true, pixelGrid: false })).toEqual(
      { ...DEFAULT_VIEW_SETTINGS, rulers: true, pixelGrid: false },
    );
  });

  it("drops the removed floating tweaks panel's saved state", () => {
    expect(
      parseStoredViewSettings({
        rulers: true,
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: true,
        tweaksPanelPosition: { x: 32, y: 96 },
      }),
    ).toEqual({ ...DEFAULT_VIEW_SETTINGS, rulers: true });
  });

  it("throws on a stored value of the wrong type instead of resetting it", () => {
    expect(() => parseStoredViewSettings({ rulers: "yes" })).toThrow();
  });
});
