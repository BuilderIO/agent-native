// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { DESIGN_SHORTCUTS } from "@/components/design/keyboard-shortcuts";
import { isShowKeyboardShortcutsHotkey } from "@/hooks/useDesignHotkeys";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";

function keydown(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", init);
}

/**
 * Mirrors isShowShortcutsChord in editor-chrome.bridge.ts. The bridge compiles
 * to an injected string, so it cannot be imported directly; the generated-output
 * assertion at the bottom is what keeps this copy honest.
 */
function shouldForwardShowShortcutsChord(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return false;
  return e.key === "?" || e.key === "/";
}

describe("show-keyboard-shortcuts hotkey", () => {
  it("matches the macOS chord, which arrives as '/' not '?'", () => {
    // Control suppresses the shifted character on macOS, so Control+Shift+/
    // never produces "?" there. Matching only "?" left Macs with no binding.
    expect(
      isShowKeyboardShortcutsHotkey(
        keydown({ key: "/", code: "Slash", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches the Windows chord, which arrives as '?'", () => {
    expect(
      isShowKeyboardShortcutsHotkey(
        keydown({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches the Command variant so a host-level ⌘⇧? still resolves", () => {
    expect(
      isShowKeyboardShortcutsHotkey(
        keydown({ key: "/", code: "Slash", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("ignores the chord without Shift", () => {
    expect(
      isShowKeyboardShortcutsHotkey(
        keydown({ key: "/", code: "Slash", ctrlKey: true }),
      ),
    ).toBe(false);
  });

  it("ignores the chord with Alt held", () => {
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

  it("ignores a bare slash so typing '/' never opens the panel", () => {
    expect(
      isShowKeyboardShortcutsHotkey(keydown({ key: "/", code: "Slash" })),
    ).toBe(false);
  });

  it("still matches auto-repeat, leaving repeat filtering to the caller", () => {
    // The panel toggles, so DesignEditor drops repeats to keep one physical
    // press to one toggle — but it swallows them first, otherwise a held chord
    // leaks "/" into the agent composer. Filtering repeat here would undo that.
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

describe("canvas iframe forwarding", () => {
  it("forwards the macOS chord out of the iframe", () => {
    expect(
      shouldForwardShowShortcutsChord(
        keydown({ key: "/", code: "Slash", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("forwards the Windows chord out of the iframe", () => {
    expect(
      shouldForwardShowShortcutsChord(
        keydown({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("does not forward a bare slash typed inside the canvas", () => {
    expect(
      shouldForwardShowShortcutsChord(keydown({ key: "/", code: "Slash" })),
    ).toBe(false);
  });

  it("agrees with the host matcher on every case", () => {
    const cases: KeyboardEventInit[] = [
      { key: "/", ctrlKey: true, shiftKey: true },
      { key: "?", ctrlKey: true, shiftKey: true },
      { key: "/", metaKey: true, shiftKey: true },
      { key: "/", ctrlKey: true },
      { key: "/", ctrlKey: true, shiftKey: true, altKey: true },
      { key: "/" },
      { key: "a", ctrlKey: true, shiftKey: true },
    ];
    for (const init of cases) {
      const event = keydown({ code: "Slash", ...init });
      expect(shouldForwardShowShortcutsChord(event)).toBe(
        isShowKeyboardShortcutsHotkey(event),
      );
    }
  });

  it("is present in the generated bridge, not only the source", () => {
    // The bridge edit is inert until `pnpm codegen:bridge` runs.
    expect(editorChromeBridgeScript).toContain("isShowShortcutsChord");
  });
});

describe("shortcut table", () => {
  it("advertises the literal Control binding, not $mod", () => {
    // ⌘⇧? is the macOS Help-menu shortcut and the browser eats it, so ⌃⇧? is
    // the only pressable binding on a Mac. Do not "fix" this to $mod.
    const showShortcuts = DESIGN_SHORTCUTS.find(
      (entry) => entry.id === "show-shortcuts",
    );
    expect(showShortcuts?.bindings).toEqual(["ctrl+shift+?"]);
  });
});
