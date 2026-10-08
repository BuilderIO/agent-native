import { describe, expect, it } from "vitest";

import { createCoreCommands } from "./code-workbench/commands";
import { buildShortcutSections } from "./keyboard-shortcut-sections";
import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
  formatShortcutKeycaps,
  formatShortcutLabel,
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
  it("orders Windows modifiers Ctrl, Alt, Shift and never doubles Ctrl", () => {
    expect(formatShortcutKeycaps("$mod+alt+g", false)).toEqual([
      "Ctrl",
      "Alt",
      "G",
    ]);
    expect(formatShortcutKeycaps("$mod+alt+g", true)).toEqual(["⌥", "⌘", "G"]);
    expect(formatShortcutKeycaps("ctrl+$mod+t", false)).toEqual(["Ctrl", "T"]);
  });

  it("spells menu hints for the viewer's platform, not the author's Mac", () => {
    expect(formatShortcutLabel("$mod+shift+r", true)).toBe("⇧⌘R");
    expect(formatShortcutLabel("$mod+shift+r", false)).toBe("Ctrl+Shift+R");
    expect(formatShortcutLabel("alt+a", true)).toBe("⌥A");
    expect(formatShortcutLabel("alt+a", false)).toBe("Alt+A");
    expect(formatShortcutLabel("", true)).toBe("");
  });

  it("advertises Cmd/Ctrl+\\ for toggling the Design chrome", () => {
    expect(
      DESIGN_SHORTCUTS.find((shortcut) => shortcut.id === "toggle-ui")
        ?.bindings,
    ).toEqual(["$mod+\\"]);
  });

  it("advertises Cmd/Ctrl+Shift+\\ for minimal Design chrome", () => {
    expect(
      DESIGN_SHORTCUTS.find((shortcut) => shortcut.id === "toggle-minimal-ui")
        ?.bindings,
    ).toEqual(["$mod+shift+\\"]);
  });
});

describe("shortcut sections", () => {
  const build = (query: string, codeCommands = createCoreCommands()) =>
    buildShortcutSections({
      query,
      applePlatform: false,
      categoryLabel: (category) => category,
      rowLabel: (labelKey) => labelKey.split(".").pop() ?? labelKey,
      codeCommands,
    });

  it("returns every category once, in catalog order, with no query", () => {
    expect(build("").map((section) => section.category)).toEqual([
      ...DESIGN_SHORTCUT_CATEGORIES,
    ]);
  });

  it("lists each Design shortcut exactly once across sections", () => {
    const ids = build("")
      .flatMap((section) => section.rows)
      .filter((row) => row.source === "design")
      .map((row) => row.id);
    expect(ids.sort()).toEqual(DESIGN_SHORTCUTS.map((item) => item.id).sort());
  });

  it("places workbench commands under their mapped categories", () => {
    const edit = build("").find((section) => section.category === "edit");
    expect(edit?.rows.find((row) => row.id === "workbench.save")?.badge).toBe(
      "code",
    );
  });

  it("drops categories with no matching row", () => {
    const sections = build("undo");
    expect(sections.map((section) => section.category)).toEqual(["essential"]);
    expect(sections[0]?.rows.map((row) => row.id)).toEqual(["undo"]);
  });

  it("matches on the key as well as the label", () => {
    const rows = build("alt+1".replace("+", " ")).flatMap(
      (section) => section.rows,
    );
    expect(rows.map((row) => row.id)).toContain("show-layers");
  });

  it("returns nothing for a query that matches no row", () => {
    expect(build("qqqqq")).toEqual([]);
  });
});
