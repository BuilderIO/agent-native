import { describe, expect, it } from "vitest";

import { normalizeCanvasHotkeyKey } from "./hotkey-keys.js";

describe("normalizeCanvasHotkeyKey", () => {
  it("reads the letter from the physical key when Option changes the character", () => {
    expect(normalizeCanvasHotkeyKey({ key: "©", code: "KeyG" })).toBe("g");
    expect(normalizeCanvasHotkeyKey({ key: "”", code: "BracketLeft" })).toBe(
      "[",
    );
  });

  it("keeps typed letters, named keys and space", () => {
    expect(normalizeCanvasHotkeyKey({ key: "G", code: "KeyG" })).toBe("g");
    expect(normalizeCanvasHotkeyKey({ key: "ArrowUp", code: "ArrowUp" })).toBe(
      "ArrowUp",
    );
    expect(normalizeCanvasHotkeyKey({ key: " ", code: "Space" })).toBe("space");
    expect(normalizeCanvasHotkeyKey({ key: "=", code: "Equal" })).toBe("=");
  });
});
