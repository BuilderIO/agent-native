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
  | "add-step"
  | "zoom-in"
  | "zoom-out"
  | "arrange"
  | "open-details"
  | "rename"
  | "test-workflow"
  | "select-upstream"
  | "select-downstream"
  | "select-upstream-chain"
  | "select-downstream-chain"
  | "arrow-up-down";

interface WorkflowShortcut extends CanvasShortcut {
  id: WorkflowShortcutId;
  /** `mod` is Command on a Mac and Control elsewhere. */
  display: readonly string[];
}

/**
 * The canvas commands the toolkit's registry resolves, so these keys behave as
 * they do on the other canvases.
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
 * Keys the registry does not carry: bare letters, Enter, F2, Space, arrows and
 * symbols. Modifiers match exactly, as the registry's do. Shift is listed only
 * where the key needs it; `either` is for a symbol that needs Shift on some
 * layouts and not on others, such as + and _.
 */
interface WorkflowKey {
  id: WorkflowShortcutId;
  key: string;
  code?: string;
  shift?: boolean | "either";
  alt?: boolean;
  /** Command on a Mac, Control elsewhere. */
  primary?: boolean;
  display: readonly string[];
}

/** The first entry for each id is the one tooltips and menus show. */
export const WORKFLOW_KEYS: readonly WorkflowKey[] = [
  { id: "add-step", key: "n", display: ["N"] },
  { id: "add-step", key: "Tab", display: ["Tab"] },
  { id: "fit-view", key: "1", display: ["1"] },
  { id: "zoom-in", key: "=", shift: "either", display: ["+"] },
  { id: "zoom-in", key: "+", shift: "either", display: ["+"] },
  { id: "zoom-out", key: "-", shift: "either", display: ["-"] },
  { id: "zoom-out", key: "_", shift: "either", display: ["-"] },
  {
    id: "arrange",
    key: "t",
    code: "KeyT",
    shift: true,
    alt: true,
    display: ["shift", "alt", "T"],
  },
  { id: "open-details", key: "Enter", display: ["Enter"] },
  {
    id: "test-workflow",
    key: "Enter",
    primary: true,
    display: ["mod", "Enter"],
  },
  { id: "rename", key: "F2", display: ["F2"] },
  { id: "rename", key: " ", display: ["Space"] },
  { id: "select-upstream", key: "ArrowLeft", display: ["←"] },
  { id: "select-downstream", key: "ArrowRight", display: ["→"] },
  {
    id: "select-upstream-chain",
    key: "ArrowLeft",
    shift: true,
    display: ["shift", "←"],
  },
  {
    id: "select-downstream-chain",
    key: "ArrowRight",
    shift: true,
    display: ["shift", "→"],
  },
  { id: "arrow-up-down", key: "ArrowUp", shift: "either", display: ["↑"] },
  { id: "arrow-up-down", key: "ArrowDown", shift: "either", display: ["↓"] },
];

const registry = createCanvasShortcutRegistry(WORKFLOW_SHORTCUTS);
const idByCommand = new Map<CanvasCommandId, WorkflowShortcutId>(
  WORKFLOW_SHORTCUTS.map((shortcut) => [shortcut.command, shortcut.id]),
);

function matchesWorkflowKey(
  entry: WorkflowKey,
  input: CanvasShortcutInput,
): boolean {
  const named = input.key.toLowerCase() === entry.key.toLowerCase();
  const coded = entry.code !== undefined && input.code === entry.code;
  if (!named && !coded) return false;
  const shift =
    entry.shift === "either" ||
    Boolean(input.shiftKey) === Boolean(entry.shift);
  return (
    shift &&
    Boolean(input.altKey) === Boolean(entry.alt) &&
    Boolean(input.metaKey || input.ctrlKey) === Boolean(entry.primary)
  );
}

export function resolveWorkflowShortcut(
  input: CanvasShortcutInput,
): WorkflowShortcutId | null {
  const key = WORKFLOW_KEYS.find((entry) => matchesWorkflowKey(entry, input));
  if (key) return key.id;
  const command = registry.resolve(input);
  return command ? (idByCommand.get(command) ?? null) : null;
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "Esc",
};
const OTHER_SYMBOLS: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
};

export function shortcutLabel(id: WorkflowShortcutId, mac: boolean): string {
  const shortcut = [...WORKFLOW_KEYS, ...WORKFLOW_SHORTCUTS].find(
    (candidate) => candidate.id === id,
  );
  if (!shortcut) return "";
  const symbols = mac ? MAC_SYMBOLS : OTHER_SYMBOLS;
  return shortcut.display
    .map((token) => symbols[token] ?? token)
    .join(mac ? "" : "+");
}
