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

  it("restores the floating tweaks panel's open, collapsed, and docked state", () => {
    expect(
      parseStoredViewSettings({
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: true,
        tweaksPanelPosition: { x: 32, y: 96 },
      }),
    ).toEqual({
      ...DEFAULT_VIEW_SETTINGS,
      tweaksPanelOpen: false,
      tweaksPanelCollapsed: true,
      tweaksPanelPosition: { x: 32, y: 96 },
    });
  });

  it("throws on a stored value of the wrong type instead of resetting it", () => {
    expect(() => parseStoredViewSettings({ rulers: "yes" })).toThrow();
  });
});
