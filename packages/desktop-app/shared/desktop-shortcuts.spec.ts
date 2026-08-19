import { describe, expect, it } from "vitest";

import {
  formatDesktopShortcutAccelerator,
  normalizeDesktopShortcutAccelerator,
} from "./desktop-shortcuts";

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
