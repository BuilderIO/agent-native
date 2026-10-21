import { describe, expect, it } from "vitest";

import {
  WORKFLOW_KEYS,
  WORKFLOW_SHORTCUTS,
  resolveWorkflowShortcut,
  shortcutLabel,
  type WorkflowShortcutId,
} from "./shortcuts";

const press = (
  key: string,
  modifiers: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  } = {},
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
    ["fit view with a plain 1", "fit-view", ["1"]],
    ["deselect", "deselect", ["Escape"]],
    ["Tab adds a step", "add-step", ["Tab"]],
    ["N adds a step", "add-step", ["n"]],
    ["Shift+N is not bound", null, ["N", { shiftKey: true }]],
    ["Shift+Tab keeps moving focus", null, ["Tab", { shiftKey: true }]],
    ["a plain letter", null, ["d"]],
    [
      "undo with an extra shift is redo, not undo",
      "redo",
      ["Z", { metaKey: true, shiftKey: true }],
    ],
    ["+ zooms in", "zoom-in", ["+", { shiftKey: true }]],
    ["= zooms in", "zoom-in", ["="]],
    ["- zooms out", "zoom-out", ["-"]],
    ["_ zooms out", "zoom-out", ["_", { shiftKey: true }]],
    [
      "Shift+Alt+T arranges",
      "arrange",
      ["†", { altKey: true, shiftKey: true }, "KeyT"],
    ],
    ["Alt+T alone is not bound", null, ["†", { altKey: true }, "KeyT"]],
    ["Enter opens details", "open-details", ["Enter"]],
    ["Command+Enter tests", "test-workflow", ["Enter", { metaKey: true }]],
    ["Control+Enter tests", "test-workflow", ["Enter", { ctrlKey: true }]],
    ["Shift+Enter is not bound", null, ["Enter", { shiftKey: true }]],
    ["F2 renames", "rename", ["F2"]],
    ["Space renames", "rename", [" "]],
    ["Left selects the upstream step", "select-upstream", ["ArrowLeft"]],
    ["Right selects the downstream step", "select-downstream", ["ArrowRight"]],
    [
      "Shift+Left selects the upstream chain",
      "select-upstream-chain",
      ["ArrowLeft", { shiftKey: true }],
    ],
    [
      "Shift+Right selects the downstream chain",
      "select-downstream-chain",
      ["ArrowRight", { shiftKey: true }],
    ],
    ["Up is held in place", "arrow-up-down", ["ArrowUp"]],
    [
      "Shift+Down is held in place",
      "arrow-up-down",
      ["ArrowDown", { shiftKey: true }],
    ],
  ])("%s", (_name, expected, args) => {
    expect(press(...args)).toBe(expected);
  });

  it("gives each shortcut a label", () => {
    for (const { id } of [...WORKFLOW_SHORTCUTS, ...WORKFLOW_KEYS]) {
      expect(shortcutLabel(id, true).length).toBeGreaterThan(0);
    }
    expect(shortcutLabel("undo", true)).toBe("⌘Z");
    expect(shortcutLabel("undo", false)).toBe("Ctrl+Z");
    expect(shortcutLabel("redo", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("add-step", true)).toBe("N");
    expect(shortcutLabel("fit-view", true)).toBe("1");
    expect(shortcutLabel("arrange", true)).toBe("⇧⌥T");
    expect(shortcutLabel("arrange", false)).toBe("Shift+Alt+T");
    expect(shortcutLabel("test-workflow", true)).toBe("⌘Enter");
  });
});
