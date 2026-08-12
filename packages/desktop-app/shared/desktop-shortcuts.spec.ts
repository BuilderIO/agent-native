import { describe, expect, it } from "vitest";

import { normalizeDesktopShortcutAccelerator } from "./desktop-shortcuts";

describe("normalizeDesktopShortcutAccelerator", () => {
  it("keeps the native macOS hide shortcut available", () => {
    expect(normalizeDesktopShortcutAccelerator("Command+H")).toEqual({
      error: expect.stringContaining("does not override"),
    });
  });
});
