// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("desktop terminal preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("persists the last selected new-tab mode", async () => {
    const preferences = await import("./desktop-terminal-preferences.js");

    preferences.writeDesktopTerminalPreferences({ enabled: true });

    expect(preferences.readDesktopTerminalPreferences().enabled).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          preferences.DESKTOP_TERMINAL_PREFERENCES_STORAGE_KEY,
        )!,
      ),
    ).toMatchObject({ enabled: true });

    preferences.writeDesktopTerminalPreferences({ enabled: false });

    expect(preferences.readDesktopTerminalPreferences().enabled).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          preferences.DESKTOP_TERMINAL_PREFERENCES_STORAGE_KEY,
        )!,
      ),
    ).toMatchObject({ enabled: false });
  });
});
