import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_SETTINGS,
  parseStoredViewSettings,
} from "./view-settings";

describe("parseStoredViewSettings", () => {
  it("returns the defaults for a user who never saved anything", () => {
    expect(parseStoredViewSettings(null)).toEqual({
      ...DEFAULT_VIEW_SETTINGS,
      tweaksPanelOpen: true,
      tweaksPanelCollapsed: false,
      tweaksPanelPosition: { x: 16, y: 64 },
    });
  });

  it("keeps saved values and defaults the rest", () => {
    expect(parseStoredViewSettings({ rulers: true, pixelGrid: false })).toEqual(
      {
        ...DEFAULT_VIEW_SETTINGS,
        rulers: true,
        pixelGrid: false,
        tweaksPanelOpen: true,
        tweaksPanelCollapsed: false,
        tweaksPanelPosition: { x: 16, y: 64 },
      },
    );
  });

  it("preserves the removed floating tweaks panel's saved state", () => {
    expect(
      parseStoredViewSettings({
        rulers: true,
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: true,
        tweaksPanelPosition: { x: 32, y: 96 },
      }),
    ).toEqual({
      ...DEFAULT_VIEW_SETTINGS,
      rulers: true,
      tweaksPanelOpen: false,
      tweaksPanelCollapsed: true,
      tweaksPanelPosition: { x: 32, y: 96 },
    });
  });

  it("throws on a current stored value of the wrong type", () => {
    expect(() => parseStoredViewSettings({ rulers: "yes" })).toThrow();
  });

  it("preserves valid legacy fields when another legacy field is malformed", () => {
    expect(
      parseStoredViewSettings({
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: true,
        tweaksPanelPosition: null,
      }),
    ).toMatchObject({
      tweaksPanelOpen: false,
      tweaksPanelCollapsed: true,
      tweaksPanelPosition: { x: 16, y: 64 },
    });
  });
});
