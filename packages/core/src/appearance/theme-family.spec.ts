import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_FAMILY,
  getThemeFamilyInitScript,
  isThemeFamily,
  themeFamilySettingKey,
  themeFamilyAppStateKey,
  themeFamilyStorageKey,
  THEME_FAMILY_APP_STATE_KEY,
  THEME_FAMILY_STORAGE_KEY,
} from "./theme-family.js";

describe("theme family contract", () => {
  it("keeps families separate from light and dark color modes", () => {
    expect(isThemeFamily("agent-native")).toBe(true);
    expect(isThemeFamily("original")).toBe(true);
    expect(isThemeFamily("light")).toBe(false);
    expect(isThemeFamily("dark")).toBe(false);
    expect(DEFAULT_THEME_FAMILY).toBe("original");
  });

  it("scopes durable settings by app and gives absent app ids a stable fallback", () => {
    expect(themeFamilySettingKey("sample-app")).toBe("theme-family:sample-app");
    expect(themeFamilySettingKey("mail/2")).toBe("theme-family:mail%2F2");
    expect(themeFamilyStorageKey("sample-app")).toBe("theme-family:sample-app");
    expect(themeFamilySettingKey()).toBe("theme-family:__no_app_id__");
    expect(() => themeFamilySettingKey(" ")).toThrow("non-empty appId");
    expect(themeFamilyAppStateKey("sample-app")).toMatch(
      /^theme-family:(?:[0-9a-f]+_?)+$/,
    );
    expect(themeFamilyAppStateKey()).toBe("theme-family:__no_app_id__");
    expect(THEME_FAMILY_APP_STATE_KEY).toBe("theme-family");
  });

  it("initializes only the theme-family attribute from local storage", () => {
    const script = getThemeFamilyInitScript();
    expect(script).toContain(THEME_FAMILY_STORAGE_KEY);
    expect(script).toContain("theme-family:__no_app_id__");
    expect(script).toContain("data-theme-family");
    expect(script).not.toContain("matchMedia");
    expect(script).not.toContain("classList");
    expect(script).not.toContain("data-theme'");
  });

  it("uses the fallback storage key before an app id is available", () => {
    const script = getThemeFamilyInitScript(null);

    expect(script).toContain("theme-family:__no_app_id__");
  });
});
