import { describe, expect, it } from "vitest";

import {
  asDesktopSettingsTab,
  DESKTOP_SETTINGS_TABS,
  initialDesktopSettingsTab,
} from "./settings-navigation";

describe("desktop settings navigation", () => {
  it("preserves an explicitly requested tab", () => {
    expect(initialDesktopSettingsTab("dictation")).toBe("dictation");
  });

  it("defaults generic settings opens to General", () => {
    expect(initialDesktopSettingsTab()).toBe("general");
  });

  it("keeps Advanced reachable as an explicit destination", () => {
    expect(initialDesktopSettingsTab("advanced")).toBe("advanced");
  });

  // Rewind is a destination of its own, not a popover inside Advanced — the
  // memory view's back button and `#settings/rewind` both target it directly.
  it("treats Rewind as a top-level destination", () => {
    expect(initialDesktopSettingsTab("rewind")).toBe("rewind");
  });

  it("routes a known `#settings/<tab>` detail to its tab", () => {
    expect(asDesktopSettingsTab("advanced")).toBe("advanced");
  });

  it("rejects unknown, empty, or missing route details", () => {
    expect(asDesktopSettingsTab("bogus")).toBeUndefined();
    expect(asDesktopSettingsTab(undefined)).toBeUndefined();
    expect(asDesktopSettingsTab("")).toBeUndefined();
  });

  it("lists each settings tab exactly once", () => {
    expect(new Set(DESKTOP_SETTINGS_TABS).size).toBe(
      DESKTOP_SETTINGS_TABS.length,
    );
  });
});
