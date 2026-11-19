// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("desktop chat preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("defaults resetChatOnAppSwitch to false and persists updates", async () => {
    const prefs = await import("./desktop-chat-preferences.js");

    expect(prefs.readDesktopChatPreferences()).toEqual({
      resetChatOnAppSwitch: false,
    });

    const updated = prefs.writeDesktopChatPreferences({
      resetChatOnAppSwitch: true,
    });
    expect(updated).toEqual({ resetChatOnAppSwitch: true });
    expect(prefs.readDesktopChatPreferences()).toEqual({
      resetChatOnAppSwitch: true,
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          prefs.DESKTOP_CHAT_PREFERENCES_STORAGE_KEY,
        ) ?? "{}",
      ),
    ).toEqual({ resetChatOnAppSwitch: true });
  });

  it("restores persisted preferences on reload and ignores malformed storage", async () => {
    window.localStorage.setItem(
      "agent-native:desktop-chat-preferences:v1",
      JSON.stringify({ resetChatOnAppSwitch: true }),
    );
    const reloaded = await import("./desktop-chat-preferences.js");
    expect(reloaded.readDesktopChatPreferences()).toEqual({
      resetChatOnAppSwitch: true,
    });

    vi.resetModules();
    window.localStorage.setItem(
      "agent-native:desktop-chat-preferences:v1",
      "{not-json",
    );
    const fallback = await import("./desktop-chat-preferences.js");
    expect(fallback.readDesktopChatPreferences()).toEqual({
      resetChatOnAppSwitch: false,
    });
  });
});
