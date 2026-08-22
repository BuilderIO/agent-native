import { describe, expect, it } from "vitest";

import {
  formatDesktopShortcutAccelerator,
  isDesktopChatToggleShortcut,
  normalizeDesktopShortcutAccelerator,
} from "./desktop-shortcuts";

describe("isDesktopChatToggleShortcut", () => {
  it("recognizes backslash from either keyboard representation", () => {
    expect(isDesktopChatToggleShortcut({ key: "\\" })).toBe(true);
    expect(isDesktopChatToggleShortcut({ code: "Backslash" })).toBe(true);
    expect(isDesktopChatToggleShortcut({ key: "|", code: "Backslash" })).toBe(
      false,
    );
  });

  it("does not treat modified backslash keys as the chat toggle", () => {
    expect(
      isDesktopChatToggleShortcut({
        key: "\\",
        code: "Backslash",
        shift: true,
      }),
    ).toBe(false);
    expect(
      isDesktopChatToggleShortcut({
        key: "\\",
        code: "Backslash",
        alt: true,
      }),
    ).toBe(false);
  });
});

describe("normalizeDesktopShortcutAccelerator", () => {
  it("keeps the native macOS hide shortcut available", () => {
    expect(normalizeDesktopShortcutAccelerator("Command+H")).toEqual({
      error: expect.stringContaining("does not override"),
    });
  });
});

describe("formatDesktopShortcutAccelerator", () => {
  it("separates display keys with spaces", () => {
    expect(formatDesktopShortcutAccelerator("Command+Shift+V", "darwin")).toBe(
      "Cmd Shift V",
    );
  });
});
