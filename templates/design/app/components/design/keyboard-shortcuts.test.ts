import { describe, expect, it } from "vitest";

import { createCoreCommands } from "./code-workbench/commands";
import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
  formatShortcutKeycaps,
} from "./keyboard-shortcuts";

describe("keyboard shortcuts catalog", () => {
  it("keeps the Figma category order and gives every category real commands", () => {
    expect(DESIGN_SHORTCUT_CATEGORIES).toEqual([
      "essential",
      "tools",
      "view",
      "zoom",
      "text",
      "shape",
      "selection",
      "cursor",
      "edit",
      "transform",
      "arrange",
      "components",
      "layout",
    ]);
    for (const category of DESIGN_SHORTCUT_CATEGORIES) {
      expect(
        DESIGN_SHORTCUTS.some((shortcut) => shortcut.category === category),
      ).toBe(true);
    }
  });

  it("has unique ids and only documents wired Design handler names", () => {
    const ids = DESIGN_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of DESIGN_SHORTCUTS) {
      expect(shortcut.handler).toMatch(/^on[A-Z]/);
      expect(shortcut.bindings.length).toBeGreaterThan(0);
    }
  });

  it("takes code-specific rows from the live workbench command registry", () => {
    const commands = createCoreCommands().filter(
      (command) => command.keybindings?.length,
    );
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workbench.save",
          keybindings: ["$mod+s"],
        }),
        expect.objectContaining({
          id: "workbench.commandPalette",
          keybindings: ["$mod+shift+p", "f1"],
        }),
      ]),
    );
  });

  it("formats platform modifiers as individual keycaps", () => {
    expect(formatShortcutKeycaps("$mod+shift+p", true)).toEqual([
      "⇧",
      "⌘",
      "P",
    ]);
    expect(formatShortcutKeycaps("ctrl+shift+?", false)).toEqual([
      "Ctrl",
      "Shift",
      "?",
    ]);
    expect(formatShortcutKeycaps("+", true)).toEqual(["+"]);
  });
});
