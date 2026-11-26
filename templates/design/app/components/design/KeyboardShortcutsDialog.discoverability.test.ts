// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { isShowKeyboardShortcutsHotkey } from "@/hooks/useDesignHotkeys";

// oracle-change: removed a generated-bridge string grep and a DESIGN_SHORTCUTS table restatement; the isShowKeyboardShortcutsHotkey cases remain

function keydown(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", init);
}

function withNavigatorPlatform(platform: string, run: () => void) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    run();
  } finally {
    if (ownDescriptor) {
      Object.defineProperty(navigator, "platform", ownDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "platform");
    }
  }
}

describe("show-keyboard-shortcuts hotkey", () => {
  it("matches the macOS chord, which arrives as '/' not '?'", () => {
    withNavigatorPlatform("MacIntel", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({ key: "/", code: "Slash", metaKey: true, shiftKey: true }),
        ),
      ).toBe(true);
    });
  });

  it("matches the Windows chord, which arrives as '?'", () => {
    withNavigatorPlatform("Win32", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }),
        ),
      ).toBe(true);
    });
  });

  it("matches the macOS Control chord, which arrives as '?'", () => {
    withNavigatorPlatform("MacIntel", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }),
        ),
      ).toBe(true);
    });
  });

  it("ignores the chord without Shift", () => {
    withNavigatorPlatform("Win32", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({ key: "/", code: "Slash", ctrlKey: true }),
        ),
      ).toBe(false);
    });
  });

  it("ignores the chord with Alt held", () => {
    withNavigatorPlatform("Win32", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({
            key: "/",
            code: "Slash",
            ctrlKey: true,
            shiftKey: true,
            altKey: true,
          }),
        ),
      ).toBe(false);
    });
  });

  it("ignores a bare slash so typing '/' never opens the panel", () => {
    expect(
      isShowKeyboardShortcutsHotkey(keydown({ key: "/", code: "Slash" })),
    ).toBe(false);
  });

  it("still matches auto-repeat, leaving repeat filtering to the caller", () => {
    withNavigatorPlatform("Win32", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({
            key: "/",
            code: "Slash",
            ctrlKey: true,
            shiftKey: true,
            repeat: true,
          }),
        ),
      ).toBe(true);
    });
  });
});
