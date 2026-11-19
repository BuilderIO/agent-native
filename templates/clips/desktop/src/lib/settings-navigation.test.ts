import { describe, expect, it } from "vitest";

import {
  asDesktopSettingsTab,
  DESKTOP_SETTINGS_TABS,
  initialDesktopSettingsTab,
  visibleDesktopSettingsTabs,
} from "./settings-navigation";

const LAB_GATED_TABS = ["meetings", "dictation"];

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

  it.each(DESKTOP_SETTINGS_TABS)(
    "shows %s with every Lab off only if no Lab gates it",
    (tab) => {
      expect(
        visibleDesktopSettingsTabs({
          meetings: false,
          dictation: false,
        }).includes(tab),
      ).toBe(!LAB_GATED_TABS.includes(tab));
    },
  );

  it("gates Meetings and Dictation on their own Labs", () => {
    expect(
      visibleDesktopSettingsTabs({ meetings: true, dictation: false }),
    ).toContain("meetings");
    expect(
      visibleDesktopSettingsTabs({ meetings: true, dictation: false }),
    ).not.toContain("dictation");
    expect(
      visibleDesktopSettingsTabs({ meetings: false, dictation: true }),
    ).toContain("dictation");
    expect(
      visibleDesktopSettingsTabs({ meetings: false, dictation: true }),
    ).not.toContain("meetings");
  });

  it("keeps the sidebar in the declared tab order", () => {
    expect(
      visibleDesktopSettingsTabs({ meetings: true, dictation: true }),
    ).toEqual([...DESKTOP_SETTINGS_TABS]);
  });
});
