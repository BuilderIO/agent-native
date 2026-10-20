// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { DESIGN_SHORTCUTS } from "@/components/design/keyboard-shortcuts";
import { isShowKeyboardShortcutsHotkey } from "@/hooks/useDesignHotkeys";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";

function keydown(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", init);
}

function shouldForwardShowShortcutsChord(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false;
  return e.key === "?" || e.key === "/";
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

  it("matches the Command variant so a host-level ⌘⇧? still resolves", () => {
    withNavigatorPlatform("MacIntel", () => {
      expect(
        isShowKeyboardShortcutsHotkey(
          keydown({ key: "/", code: "Slash", metaKey: true, shiftKey: true }),
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

describe("canvas iframe forwarding", () => {
  it("forwards the macOS chord out of the iframe", () => {
    withNavigatorPlatform("MacIntel", () => {
      expect(
        shouldForwardShowShortcutsChord(
          keydown({ key: "/", code: "Slash", metaKey: true, shiftKey: true }),
        ),
      ).toBe(true);
    });
  });

  it("forwards the Windows chord out of the iframe", () => {
    withNavigatorPlatform("Win32", () => {
      expect(
        shouldForwardShowShortcutsChord(
          keydown({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }),
        ),
      ).toBe(true);
    });
  });

  it("does not forward a bare slash typed inside the canvas", () => {
    expect(
      shouldForwardShowShortcutsChord(keydown({ key: "/", code: "Slash" })),
    ).toBe(false);
  });

  it("agrees with the host matcher on every case", () => {
    const cases: Array<[string, KeyboardEventInit]> = [
      ["Win32", { key: "/", ctrlKey: true, shiftKey: true }],
      ["Win32", { key: "?", ctrlKey: true, shiftKey: true }],
      ["MacIntel", { key: "/", metaKey: true, shiftKey: true }],
      ["MacIntel", { key: "?", ctrlKey: true, shiftKey: true }],
      ["Win32", { key: "/", ctrlKey: true }],
      ["Win32", { key: "/", ctrlKey: true, shiftKey: true, altKey: true }],
      ["Win32", { key: "/" }],
      ["Win32", { key: "a", ctrlKey: true, shiftKey: true }],
    ];
    for (const [platform, init] of cases) {
      withNavigatorPlatform(platform, () => {
        const event = keydown({ code: "Slash", ...init });
        expect(shouldForwardShowShortcutsChord(event)).toBe(
          isShowKeyboardShortcutsHotkey(event),
        );
      });
    }
  });

  it("is present in the generated bridge, not only the source", () => {
    expect(editorChromeBridgeScript).toContain("isShowShortcutsChord");
  });
});

describe("shortcut table", () => {
  it("advertises the literal Control binding, not $mod", () => {
    const showShortcuts = DESIGN_SHORTCUTS.find(
      (entry) => entry.id === "show-shortcuts",
    );
    expect(showShortcuts?.bindings).toEqual(["ctrl+shift+?"]);
  });
});
