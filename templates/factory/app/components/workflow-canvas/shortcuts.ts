import {
  createCanvasShortcutRegistry,
  type CanvasCommandId,
  type CanvasShortcut,
  type CanvasShortcutInput,
} from "@agent-native/toolkit/canvas-interactions";

export type WorkflowShortcutId =
  | "delete"
  | "duplicate"
  | "undo"
  | "redo"
  | "select-all"
  | "fit-view"
  | "deselect"
  | "add-step";

interface WorkflowShortcut extends CanvasShortcut {
  id: WorkflowShortcutId;
  /** `mod` is Command on a Mac and Control elsewhere. */
  display: readonly string[];
}

/**
 * Every canvas shortcut, in one table: what the keyboard handler resolves and
 * what tooltips show. Bindings are the toolkit's canvas shortcut shape, so
 * the keys behave as they do in the other canvases.
 */
export const WORKFLOW_SHORTCUTS: readonly WorkflowShortcut[] = [
  {
    id: "undo",
    command: "undo",
    key: "z",
    modifiers: ["primary"],
    display: ["mod", "Z"],
  },
  {
    id: "redo",
    command: "redo",
    key: "z",
    modifiers: ["primary", "shift"],
    display: ["mod", "shift", "Z"],
  },
  {
    id: "redo",
    command: "redo",
    key: "y",
    modifiers: ["primary"],
    display: ["mod", "Y"],
  },
  {
    id: "duplicate",
    command: "duplicate",
    key: "d",
    modifiers: ["primary"],
    display: ["mod", "D"],
  },
  { id: "delete", command: "delete", key: "Backspace", display: ["Backspace"] },
  { id: "delete", command: "delete", key: "Delete", display: ["Delete"] },
  {
    id: "select-all",
    command: "select-all",
    key: "a",
    modifiers: ["primary"],
    display: ["mod", "A"],
  },
  {
    id: "fit-view",
    command: "frame-selection",
    key: "1",
    code: "Digit1",
    modifiers: ["shift"],
    display: ["shift", "1"],
  },
  { id: "deselect", command: "escape", key: "Escape", display: ["Escape"] },
];

/**
 * Keys the toolkit registry cannot resolve, because they are not canvas
 * commands. A direct key matches only with no modifier, so Shift+Tab still
 * moves focus.
 */
const DIRECT_SHORTCUTS: readonly {
  id: WorkflowShortcutId;
  key: string;
  display: readonly string[];
}[] = [{ id: "add-step", key: "Tab", display: ["Tab"] }];

const registry = createCanvasShortcutRegistry(WORKFLOW_SHORTCUTS);
const idByCommand = new Map<CanvasCommandId, WorkflowShortcutId>(
  WORKFLOW_SHORTCUTS.map((shortcut) => [shortcut.command, shortcut.id]),
);

export function resolveWorkflowShortcut(
  input: CanvasShortcutInput,
): WorkflowShortcutId | null {
  const direct = DIRECT_SHORTCUTS.find(
    (shortcut) =>
      shortcut.key === input.key &&
      !input.altKey &&
      !input.ctrlKey &&
      !input.metaKey &&
      !input.shiftKey,
  );
  if (direct) return direct.id;
  const command = registry.resolve(input);
  return command ? (idByCommand.get(command) ?? null) : null;
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "Esc",
};
const OTHER_SYMBOLS: Record<string, string> = { mod: "Ctrl", shift: "Shift" };

export function shortcutLabel(id: WorkflowShortcutId, mac: boolean): string {
  const shortcut = [...WORKFLOW_SHORTCUTS, ...DIRECT_SHORTCUTS].find(
    (candidate) => candidate.id === id,
  );
  if (!shortcut) return "";
  const symbols = mac ? MAC_SYMBOLS : OTHER_SYMBOLS;
  return shortcut.display
    .map((token) => symbols[token] ?? token)
    .join(mac ? "" : "+");
}
