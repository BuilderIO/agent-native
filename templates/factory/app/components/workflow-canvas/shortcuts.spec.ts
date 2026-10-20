import { describe, expect, it } from "vitest";

import {
  WORKFLOW_SHORTCUTS,
  resolveWorkflowShortcut,
  shortcutLabel,
  type WorkflowShortcutId,
} from "./shortcuts";

const press = (
  key: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
  code?: string,
) => resolveWorkflowShortcut({ key, code, ...modifiers });

describe("workflow shortcuts", () => {
  it.each<[string, WorkflowShortcutId | null, Parameters<typeof press>]>([
    ["undo", "undo", ["z", { metaKey: true }]],
    ["undo with control", "undo", ["z", { ctrlKey: true }]],
    ["redo with shift", "redo", ["z", { metaKey: true, shiftKey: true }]],
    ["redo with Y", "redo", ["y", { ctrlKey: true }]],
    ["duplicate", "duplicate", ["d", { metaKey: true }]],
    ["delete with Backspace", "delete", ["Backspace"]],
    ["delete with Delete", "delete", ["Delete"]],
    ["select all", "select-all", ["a", { metaKey: true }]],
    ["fit view", "fit-view", ["!", { shiftKey: true }, "Digit1"]],
    ["deselect", "deselect", ["Escape"]],
    ["Tab adds a step", "add-step", ["Tab"]],
    ["Shift+Tab keeps moving focus", null, ["Tab", { shiftKey: true }]],
    ["a plain letter", null, ["d"]],
    [
      "undo with an extra shift is redo, not undo",
      "redo",
      ["Z", { metaKey: true, shiftKey: true }],
    ],
  ])("%s", (_name, expected, args) => {
    expect(press(...args)).toBe(expected);
  });

  it("gives each shortcut a label", () => {
    for (const { id } of WORKFLOW_SHORTCUTS) {
      expect(shortcutLabel(id, true).length).toBeGreaterThan(0);
    }
    expect(shortcutLabel("undo", true)).toBe("⌘Z");
    expect(shortcutLabel("undo", false)).toBe("Ctrl+Z");
    expect(shortcutLabel("redo", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("add-step", true)).toBe("Tab");
  });
});
