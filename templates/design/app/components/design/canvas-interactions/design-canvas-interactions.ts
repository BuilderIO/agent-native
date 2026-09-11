import {
  resolveCanvasNudge,
  resolveCanvasShortcut,
} from "@agent-native/toolkit/canvas-interactions";
import type {
  CanvasCommand,
  CanvasCommandDispatchResult,
  CanvasCommandId,
  CanvasInteractionAdapter,
  CanvasInteractionCapabilities,
  CanvasShortcut,
  CanvasShortcutInput,
  CanvasTextEditPolicy,
} from "@agent-native/toolkit/canvas-interactions";

import type { UseDesignHotkeysProps } from "@/hooks/useDesignHotkeys";

export type DesignCanvasInteractionHandlers = Pick<
  UseDesignHotkeysProps,
  | "onSelectAll"
  | "onUndo"
  | "onRedo"
  | "onCopy"
  | "onCut"
  | "onPaste"
  | "onDuplicate"
  | "onDelete"
  | "onNudge"
  | "onBringForward"
  | "onBringToFront"
  | "onSendBackward"
  | "onSendToBack"
  | "onAlignSelection"
  | "onDistributeSelection"
  | "onGroup"
  | "onUngroup"
  | "onFrameSelection"
  | "onEscape"
  | "onEnter"
>;

export interface CreateDesignCanvasInteractionAdapterOptions {
  shortcuts: DesignCanvasInteractionHandlers;
  /**
   * The shared command contract intentionally does not carry DOM events.
   * Design provides the original event at this seam when it dispatches from
   * its existing hotkey loop, preserving source/editor behavior.
   */
  getHotkeyDetails?: (command: CanvasCommand) => DesignHotkeyDetails | null;
}

type DesignHotkeyDetails = Parameters<
  NonNullable<UseDesignHotkeysProps["onUndo"]>
>[0];

export interface DesignCanvasInteractionAdapter extends CanvasInteractionAdapter {
  readonly id: "design";
  readonly textEditing: Required<CanvasTextEditPolicy>;
  dispatchShortcut(
    command: CanvasCommandId,
    event: KeyboardEvent,
  ): CanvasCommandDispatchResult;
  dispatchKeyboardEvent(event: KeyboardEvent): CanvasCommandDispatchResult;
}

export const DESIGN_CANVAS_INTERACTION_CAPABILITIES = {
  selection: true,
  multiSelection: true,
  marquee: true,
  move: true,
  resize: true,
  rotation: true,
  snapping: true,
  alignment: true,
  distribution: true,
  duplicate: true,
  clipboard: true,
  delete: true,
  nudge: true,
  arrange: true,
  grouping: true,
  textEditing: true,
} satisfies CanvasInteractionCapabilities;

/**
 * Design's equivalent subset of the shared canvas command registry. The
 * broader Figma shortcut catalogue remains in `useDesignHotkeys`: it has
 * Design-only commands and platform rules which should not be projected onto
 * other canvases. These entries are intentionally semantic rather than tied
 * to the iframe/source persistence implementation.
 */
export const DESIGN_CANVAS_SHORTCUTS: readonly CanvasShortcut[] = [
  { command: "select-all", key: "a", modifiers: ["primary"] },
  { command: "undo", key: "z", modifiers: ["primary"] },
  { command: "redo", key: "z", modifiers: ["primary", "shift"] },
  { command: "copy", key: "c", modifiers: ["primary"] },
  { command: "cut", key: "x", modifiers: ["primary"] },
  { command: "paste", key: "v", modifiers: ["primary"] },
  { command: "duplicate", key: "d", modifiers: ["primary"] },
  { command: "delete", key: "Backspace" },
  { command: "delete", key: "Delete" },
  {
    command: "bring-forward",
    key: "]",
    code: "BracketRight",
    modifiers: ["primary"],
  },
  {
    command: "send-backward",
    key: "[",
    code: "BracketLeft",
    modifiers: ["primary"],
  },
  { command: "bring-to-front", key: "]" },
  { command: "send-to-back", key: "[" },
  {
    command: "bring-to-front",
    key: "]",
    code: "BracketRight",
    modifiers: ["primary", "alt"],
  },
  {
    command: "send-to-back",
    key: "[",
    code: "BracketLeft",
    modifiers: ["primary", "alt"],
  },
];

/** Shared semantic lookup used by Design's live hotkey shell. */
export function resolveDesignCanvasShortcut(
  input: CanvasShortcutInput,
): CanvasCommandId | null {
  return resolveCanvasShortcut(input, DESIGN_CANVAS_SHORTCUTS);
}

function canvasCommandForDesignKeyboardEvent(
  event: KeyboardEvent,
): CanvasCommandId | null {
  const shortcut = resolveDesignCanvasShortcut({
    key: event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  if (shortcut) return shortcut;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return (
    resolveCanvasNudge({ key: event.key, shiftKey: event.shiftKey })?.command ??
    null
  );
}

function dispatchDesignShortcut(
  command: CanvasCommand,
  details: DesignHotkeyDetails | null,
  handlers: DesignCanvasInteractionHandlers,
): CanvasCommandDispatchResult {
  if (!details) return { handled: false, reason: "unhandled" };

  switch (command.id) {
    case "undo":
      return runShortcutHandler(handlers.onUndo, details);
    case "redo":
      return runShortcutHandler(handlers.onRedo, details);
    case "copy":
      return runShortcutHandler(handlers.onCopy, details);
    case "cut":
      return runShortcutHandler(handlers.onCut, details);
    case "paste":
      return runShortcutHandler(handlers.onPaste, details);
    case "duplicate":
      return runShortcutHandler(handlers.onDuplicate, details);
    case "delete":
      return runShortcutHandler(handlers.onDelete, details);
    case "bring-forward":
      return runShortcutHandler(handlers.onBringForward, details);
    case "bring-to-front":
      return runShortcutHandler(handlers.onBringToFront, details);
    case "send-backward":
      return runShortcutHandler(handlers.onSendBackward, details);
    case "send-to-back":
      return runShortcutHandler(handlers.onSendToBack, details);
    case "group":
      return runShortcutHandler(handlers.onGroup, details);
    case "ungroup":
      return runShortcutHandler(handlers.onUngroup, details);
    case "frame-selection":
      return runShortcutHandler(handlers.onFrameSelection, details);
    case "escape":
      return runShortcutHandler(handlers.onEscape, details);
    case "enter":
      return runShortcutHandler(handlers.onEnter, details);
    case "nudge-left":
      return runNudgeHandler(handlers.onNudge, details, "left", command);
    case "nudge-right":
      return runNudgeHandler(handlers.onNudge, details, "right", command);
    case "nudge-up":
      return runNudgeHandler(handlers.onNudge, details, "up", command);
    case "nudge-down":
      return runNudgeHandler(handlers.onNudge, details, "down", command);
    case "align-left":
      return runAlignHandler(handlers.onAlignSelection, details, "left");
    case "align-center":
      return runAlignHandler(handlers.onAlignSelection, details, "center-h");
    case "align-right":
      return runAlignHandler(handlers.onAlignSelection, details, "right");
    case "align-top":
      return runAlignHandler(handlers.onAlignSelection, details, "top");
    case "align-middle":
      return runAlignHandler(handlers.onAlignSelection, details, "center-v");
    case "align-bottom":
      return runAlignHandler(handlers.onAlignSelection, details, "bottom");
    case "distribute-horizontal":
      return runDistributeHandler(
        handlers.onDistributeSelection,
        details,
        "horizontal",
      );
    case "distribute-vertical":
      return runDistributeHandler(
        handlers.onDistributeSelection,
        details,
        "vertical",
      );
    case "arrange-front":
      return runShortcutHandler(handlers.onBringToFront, details);
    case "arrange-back":
      return runShortcutHandler(handlers.onSendToBack, details);
    case "select-all":
      return runShortcutHandler(handlers.onSelectAll, details);
    case "nudge":
      return { handled: false, reason: "unhandled" };
  }
  return { handled: false, reason: "unhandled" };
}

function runShortcutHandler(
  handler:
    | ((details: {
        event: KeyboardEvent;
        key: string;
        primary: boolean;
        shift: boolean;
        alt: boolean;
        repeat: boolean;
      }) => void)
    | undefined,
  details: {
    event: KeyboardEvent;
    key: string;
    primary: boolean;
    shift: boolean;
    alt: boolean;
    repeat: boolean;
  },
): CanvasCommandDispatchResult {
  if (!handler) return { handled: false, reason: "unhandled" };
  handler(details);
  return { handled: true };
}

function runNudgeHandler(
  handler: UseDesignHotkeysProps["onNudge"],
  details: DesignHotkeyDetails,
  direction: "left" | "right" | "up" | "down",
  command: CanvasCommand,
): CanvasCommandDispatchResult {
  if (!handler) return { handled: false, reason: "unhandled" };
  const amount = Math.max(
    Math.abs(command.delta?.x ?? 0),
    Math.abs(command.delta?.y ?? 0),
  );
  handler({ ...details, direction, largeStep: amount >= 10 || details.shift });
  return { handled: true };
}

function runAlignHandler(
  handler: UseDesignHotkeysProps["onAlignSelection"],
  details: DesignHotkeyDetails,
  edge: "left" | "center-h" | "right" | "top" | "center-v" | "bottom",
): CanvasCommandDispatchResult {
  if (!handler) return { handled: false, reason: "unhandled" };
  handler({ ...details, edge });
  return { handled: true };
}

function runDistributeHandler(
  handler: UseDesignHotkeysProps["onDistributeSelection"],
  details: DesignHotkeyDetails,
  axis: "horizontal" | "vertical",
): CanvasCommandDispatchResult {
  if (!handler) return { handled: false, reason: "unhandled" };
  handler({ ...details, axis });
  return { handled: true };
}

/**
 * The Design adapter is deliberately small. `DesignEditor` remains the owner
 * of selection canonicalization and source writes; a future Toolkit canvas
 * controller can call this object without importing the iframe bridge.
 *
 * Wiring points:
 * - DesignCanvas onElementSelect / onElementDblClickText -> selection
 * - DesignCanvas visual/text callbacks -> persistence
 * - useDesignHotkeys handlers -> shortcuts
 */
export function createDesignCanvasInteractionAdapter(
  options: CreateDesignCanvasInteractionAdapterOptions,
): DesignCanvasInteractionAdapter {
  return {
    id: "design",
    capabilities: DESIGN_CANVAS_INTERACTION_CAPABILITIES,
    textEditing: {
      activation: "double-click",
      escapeBehavior: "select-object",
    },
    dispatch: (command) =>
      dispatchDesignShortcut(
        command,
        options.getHotkeyDetails?.(command) ?? null,
        options.shortcuts,
      ),
    dispatchShortcut: (command, event) =>
      dispatchDesignShortcut(
        { id: command },
        {
          event,
          key: event.key,
          primary: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          repeat: event.repeat,
        },
        options.shortcuts,
      ),
    dispatchKeyboardEvent: (event) => {
      const command = canvasCommandForDesignKeyboardEvent(event);
      return command
        ? dispatchDesignShortcut(
            { id: command },
            {
              event,
              key: event.key,
              primary: event.metaKey || event.ctrlKey,
              shift: event.shiftKey,
              alt: event.altKey,
              repeat: event.repeat,
            },
            options.shortcuts,
          )
        : { handled: false, reason: "unhandled" };
    },
  };
}
