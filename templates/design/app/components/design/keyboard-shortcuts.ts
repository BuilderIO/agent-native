import type { UseDesignHotkeysProps } from "@/hooks/useDesignHotkeys";

export const DESIGN_SHORTCUT_CATEGORIES = [
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
] as const;

export type DesignShortcutCategory =
  (typeof DESIGN_SHORTCUT_CATEGORIES)[number];

type DesignHotkeyHandlerKey = Exclude<
  {
    [K in keyof UseDesignHotkeysProps]: K extends `on${string}` ? K : never;
  }[keyof UseDesignHotkeysProps],
  undefined
>;

export interface DesignShortcutDefinition {
  id: string;
  category: DesignShortcutCategory;
  bindings: readonly string[];
  labelKey: `designEditor.keyboardShortcuts.commands.${string}`;
  handler: DesignHotkeyHandlerKey;
  context?: "screen";
}

const shortcut = (
  definition: DesignShortcutDefinition,
): DesignShortcutDefinition => definition;

/**
 * The user-facing Design shortcut catalog. Every row is tied to a real
 * UseDesignHotkeys handler so the panel cannot quietly advertise a command the
 * canvas does not dispatch. Code-workbench bindings are appended from its own
 * command registry by KeyboardShortcutsPanel.
 */
export const DESIGN_SHORTCUTS: readonly DesignShortcutDefinition[] = [
  shortcut({
    id: "show-shortcuts",
    category: "essential",
    bindings: ["ctrl+shift+?"],
    labelKey: "designEditor.keyboardShortcuts.commands.showShortcuts",
    handler: "onShowKeyboardShortcuts",
  }),
  shortcut({
    id: "undo",
    category: "essential",
    bindings: ["$mod+z"],
    labelKey: "designEditor.keyboardShortcuts.commands.undo",
    handler: "onUndo",
  }),
  shortcut({
    id: "redo",
    category: "essential",
    bindings: ["$mod+shift+z", "$mod+y"],
    labelKey: "designEditor.keyboardShortcuts.commands.redo",
    handler: "onRedo",
  }),

  shortcut({
    id: "move-tool",
    category: "tools",
    bindings: ["v"],
    labelKey: "designEditor.keyboardShortcuts.commands.moveTool",
    handler: "onMoveTool",
  }),
  shortcut({
    id: "frame-tool",
    category: "tools",
    bindings: ["f"],
    labelKey: "designEditor.keyboardShortcuts.commands.frameTool",
    handler: "onFrameTool",
  }),
  shortcut({
    id: "text-tool",
    category: "tools",
    bindings: ["t"],
    labelKey: "designEditor.keyboardShortcuts.commands.textTool",
    handler: "onTextTool",
  }),
  shortcut({
    id: "pen-tool",
    category: "tools",
    bindings: ["p"],
    labelKey: "designEditor.keyboardShortcuts.commands.penTool",
    handler: "onPenTool",
  }),
  shortcut({
    id: "hand-tool",
    category: "tools",
    bindings: ["h"],
    labelKey: "designEditor.keyboardShortcuts.commands.handTool",
    handler: "onHandTool",
  }),
  shortcut({
    id: "scale-tool",
    category: "tools",
    bindings: ["k"],
    labelKey: "designEditor.keyboardShortcuts.commands.scaleTool",
    handler: "onScaleTool",
  }),
  shortcut({
    id: "comment-tool",
    category: "tools",
    bindings: ["c"],
    labelKey: "designEditor.keyboardShortcuts.commands.commentTool",
    handler: "onCommentTool",
  }),
  shortcut({
    id: "draw-tool",
    category: "tools",
    bindings: ["y"],
    labelKey: "designEditor.keyboardShortcuts.commands.drawTool",
    handler: "onDrawTool",
  }),

  shortcut({
    id: "show-layers",
    category: "view",
    bindings: ["alt+1"],
    labelKey: "designEditor.keyboardShortcuts.commands.showLayers",
    handler: "onShowLayersPanel",
  }),
  shortcut({
    id: "show-assets",
    category: "view",
    bindings: ["alt+2"],
    labelKey: "designEditor.keyboardShortcuts.commands.showAssets",
    handler: "onShowAssetsPanel",
  }),
  shortcut({
    id: "toggle-ui",
    category: "view",
    bindings: ["$mod+\\"],
    labelKey: "designEditor.keyboardShortcuts.commands.toggleUi",
    handler: "onToggleUi",
  }),
  shortcut({
    id: "toggle-comments",
    category: "view",
    bindings: ["shift+c"],
    labelKey: "designEditor.keyboardShortcuts.commands.toggleComments",
    handler: "onToggleComments",
  }),

  shortcut({
    id: "zoom-in",
    category: "zoom",
    bindings: ["$mod+=", "+"],
    labelKey: "designEditor.keyboardShortcuts.commands.zoomIn",
    handler: "onZoomIn",
  }),
  shortcut({
    id: "zoom-out",
    category: "zoom",
    bindings: ["$mod+-", "-"],
    labelKey: "designEditor.keyboardShortcuts.commands.zoomOut",
    handler: "onZoomOut",
  }),
  shortcut({
    id: "zoom-reset",
    category: "zoom",
    bindings: ["$mod+0"],
    labelKey: "designEditor.keyboardShortcuts.commands.zoomReset",
    handler: "onZoomReset",
  }),
  shortcut({
    id: "zoom-fit",
    category: "zoom",
    bindings: ["shift+1"],
    labelKey: "designEditor.keyboardShortcuts.commands.zoomFit",
    handler: "onZoomToFit",
  }),
  shortcut({
    id: "zoom-selection",
    category: "zoom",
    bindings: ["shift+2"],
    labelKey: "designEditor.keyboardShortcuts.commands.zoomSelection",
    handler: "onZoomToSelection",
  }),

  shortcut({
    id: "underline",
    category: "text",
    bindings: ["$mod+u"],
    labelKey: "designEditor.keyboardShortcuts.commands.underline",
    handler: "onToggleUnderline",
  }),
  shortcut({
    id: "strikethrough",
    category: "text",
    bindings: ["$mod+shift+x"],
    labelKey: "designEditor.keyboardShortcuts.commands.strikethrough",
    handler: "onToggleStrikethrough",
  }),

  shortcut({
    id: "rectangle",
    category: "shape",
    bindings: ["r"],
    labelKey: "designEditor.keyboardShortcuts.commands.rectangle",
    handler: "onRectangleTool",
  }),
  shortcut({
    id: "ellipse",
    category: "shape",
    bindings: ["o"],
    labelKey: "designEditor.keyboardShortcuts.commands.ellipse",
    handler: "onEllipseTool",
  }),
  shortcut({
    id: "line",
    category: "shape",
    bindings: ["l"],
    labelKey: "designEditor.keyboardShortcuts.commands.line",
    handler: "onLineTool",
  }),
  shortcut({
    id: "arrow",
    category: "shape",
    bindings: ["shift+l"],
    labelKey: "designEditor.keyboardShortcuts.commands.arrow",
    handler: "onArrowTool",
  }),

  shortcut({
    id: "select-all",
    category: "selection",
    bindings: ["$mod+a"],
    labelKey: "designEditor.keyboardShortcuts.commands.selectAll",
    handler: "onSelectAll",
  }),
  shortcut({
    id: "select-parent",
    category: "selection",
    bindings: ["\\", "shift+enter"],
    labelKey: "designEditor.keyboardShortcuts.commands.selectParent",
    handler: "onSelectParent",
  }),
  shortcut({
    id: "enter",
    category: "selection",
    bindings: ["enter"],
    labelKey: "designEditor.keyboardShortcuts.commands.enterSelection",
    handler: "onEnter",
  }),
  shortcut({
    id: "next-sibling",
    category: "selection",
    bindings: ["tab"],
    labelKey: "designEditor.keyboardShortcuts.commands.nextSibling",
    handler: "onTab",
  }),
  shortcut({
    id: "previous-sibling",
    category: "selection",
    bindings: ["shift+tab"],
    labelKey: "designEditor.keyboardShortcuts.commands.previousSibling",
    handler: "onTab",
  }),
  shortcut({
    id: "next-screen",
    category: "selection",
    bindings: ["n"],
    labelKey: "designEditor.keyboardShortcuts.commands.nextScreen",
    handler: "onNextFrame",
    context: "screen",
  }),
  shortcut({
    id: "previous-screen",
    category: "selection",
    bindings: ["shift+n"],
    labelKey: "designEditor.keyboardShortcuts.commands.previousScreen",
    handler: "onPreviousFrame",
    context: "screen",
  }),

  shortcut({
    id: "nudge",
    category: "cursor",
    bindings: ["arrowup", "arrowright", "arrowdown", "arrowleft"],
    labelKey: "designEditor.keyboardShortcuts.commands.nudge",
    handler: "onNudge",
  }),
  shortcut({
    id: "nudge-large",
    category: "cursor",
    bindings: [
      "shift+arrowup",
      "shift+arrowright",
      "shift+arrowdown",
      "shift+arrowleft",
    ],
    labelKey: "designEditor.keyboardShortcuts.commands.nudgeLarge",
    handler: "onNudge",
  }),

  shortcut({
    id: "copy",
    category: "edit",
    bindings: ["$mod+c"],
    labelKey: "designEditor.keyboardShortcuts.commands.copy",
    handler: "onCopy",
  }),
  shortcut({
    id: "copy-png",
    category: "edit",
    bindings: ["$mod+shift+c"],
    labelKey: "designEditor.keyboardShortcuts.commands.copyPng",
    handler: "onCopyAsPng",
  }),
  shortcut({
    id: "cut",
    category: "edit",
    bindings: ["$mod+x"],
    labelKey: "designEditor.keyboardShortcuts.commands.cut",
    handler: "onCut",
  }),
  shortcut({
    id: "paste",
    category: "edit",
    bindings: ["$mod+v"],
    labelKey: "designEditor.keyboardShortcuts.commands.paste",
    handler: "onPaste",
  }),
  shortcut({
    id: "paste-over",
    category: "edit",
    bindings: ["$mod+shift+v"],
    labelKey: "designEditor.keyboardShortcuts.commands.pasteOver",
    handler: "onPasteOver",
  }),
  shortcut({
    id: "copy-properties",
    category: "edit",
    bindings: ["$mod+alt+c"],
    labelKey: "designEditor.keyboardShortcuts.commands.copyProperties",
    handler: "onCopyProps",
  }),
  shortcut({
    id: "paste-properties",
    category: "edit",
    bindings: ["$mod+alt+v"],
    labelKey: "designEditor.keyboardShortcuts.commands.pasteProperties",
    handler: "onPasteProps",
  }),
  shortcut({
    id: "paste-replace",
    category: "edit",
    bindings: ["$mod+shift+r"],
    labelKey: "designEditor.keyboardShortcuts.commands.pasteReplace",
    handler: "onPasteToReplace",
  }),
  shortcut({
    id: "duplicate",
    category: "edit",
    bindings: ["$mod+d"],
    labelKey: "designEditor.keyboardShortcuts.commands.duplicate",
    handler: "onDuplicate",
  }),
  shortcut({
    id: "delete",
    category: "edit",
    bindings: ["backspace", "delete"],
    labelKey: "designEditor.keyboardShortcuts.commands.delete",
    handler: "onDelete",
  }),
  shortcut({
    id: "rename",
    category: "edit",
    bindings: ["$mod+r"],
    labelKey: "designEditor.keyboardShortcuts.commands.rename",
    handler: "onRename",
  }),
  shortcut({
    id: "find",
    category: "edit",
    bindings: ["$mod+f"],
    labelKey: "designEditor.keyboardShortcuts.commands.find",
    handler: "onFind",
  }),

  shortcut({
    id: "flip-horizontal",
    category: "transform",
    bindings: ["shift+h"],
    labelKey: "designEditor.keyboardShortcuts.commands.flipHorizontal",
    handler: "onFlipHorizontal",
  }),
  shortcut({
    id: "flip-vertical",
    category: "transform",
    bindings: ["shift+v"],
    labelKey: "designEditor.keyboardShortcuts.commands.flipVertical",
    handler: "onFlipVertical",
  }),
  shortcut({
    id: "swap-fill-stroke",
    category: "transform",
    bindings: ["shift+x"],
    labelKey: "designEditor.keyboardShortcuts.commands.swapFillStroke",
    handler: "onSwapFillStroke",
  }),

  shortcut({
    id: "bring-forward",
    category: "arrange",
    bindings: ["$mod+]"],
    labelKey: "designEditor.keyboardShortcuts.commands.bringForward",
    handler: "onBringForward",
  }),
  shortcut({
    id: "send-backward",
    category: "arrange",
    bindings: ["$mod+["],
    labelKey: "designEditor.keyboardShortcuts.commands.sendBackward",
    handler: "onSendBackward",
  }),
  shortcut({
    id: "bring-front",
    category: "arrange",
    bindings: ["]"],
    labelKey: "designEditor.keyboardShortcuts.commands.bringFront",
    handler: "onBringToFront",
  }),
  shortcut({
    id: "send-back",
    category: "arrange",
    bindings: ["["],
    labelKey: "designEditor.keyboardShortcuts.commands.sendBack",
    handler: "onSendToBack",
  }),
  shortcut({
    id: "align-left",
    category: "arrange",
    bindings: ["alt+a"],
    labelKey: "designEditor.keyboardShortcuts.commands.alignLeft",
    handler: "onAlignSelection",
  }),
  shortcut({
    id: "align-right",
    category: "arrange",
    bindings: ["alt+d"],
    labelKey: "designEditor.keyboardShortcuts.commands.alignRight",
    handler: "onAlignSelection",
  }),
  shortcut({
    id: "align-top",
    category: "arrange",
    bindings: ["alt+w"],
    labelKey: "designEditor.keyboardShortcuts.commands.alignTop",
    handler: "onAlignSelection",
  }),
  shortcut({
    id: "align-bottom",
    category: "arrange",
    bindings: ["alt+s"],
    labelKey: "designEditor.keyboardShortcuts.commands.alignBottom",
    handler: "onAlignSelection",
  }),
  shortcut({
    id: "tidy",
    category: "arrange",
    bindings: ["ctrl+alt+t"],
    labelKey: "designEditor.keyboardShortcuts.commands.tidy",
    handler: "onTidyUp",
  }),

  shortcut({
    id: "create-component",
    category: "components",
    bindings: ["$mod+alt+k"],
    labelKey: "designEditor.keyboardShortcuts.commands.createComponent",
    handler: "onCreateComponent",
  }),
  shortcut({
    id: "detach-instance",
    category: "components",
    bindings: ["$mod+alt+b"],
    labelKey: "designEditor.keyboardShortcuts.commands.detachInstance",
    handler: "onDetachInstance",
  }),

  shortcut({
    id: "group",
    category: "layout",
    bindings: ["$mod+g"],
    labelKey: "designEditor.keyboardShortcuts.commands.group",
    handler: "onGroup",
  }),
  shortcut({
    id: "ungroup",
    category: "layout",
    bindings: ["$mod+backspace"],
    labelKey: "designEditor.keyboardShortcuts.commands.ungroup",
    handler: "onUngroup",
  }),
  shortcut({
    id: "frame-selection",
    category: "layout",
    bindings: ["$mod+alt+g"],
    labelKey: "designEditor.keyboardShortcuts.commands.frameSelection",
    handler: "onFrameSelection",
  }),
  shortcut({
    id: "auto-layout",
    category: "layout",
    bindings: ["shift+a"],
    labelKey: "designEditor.keyboardShortcuts.commands.autoLayout",
    handler: "onAddAutoLayout",
  }),
] as const;

const KEY_LABELS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  backspace: "⌫",
  delete: "⌦",
  enter: "↩",
  escape: "Esc",
  plus: "+",
  tab: "Tab",
};

export function formatShortcutKeycaps(
  binding: string,
  applePlatform: boolean,
): string[] {
  if (binding === "+") return ["+"];
  const tokens = binding.toLowerCase().split("+");
  const key = tokens.pop() ?? "";
  const keycaps: string[] = [];
  if (tokens.includes("ctrl")) keycaps.push(applePlatform ? "⌃" : "Ctrl");
  if (tokens.includes("alt")) keycaps.push(applePlatform ? "⌥" : "Alt");
  if (tokens.includes("shift")) keycaps.push(applePlatform ? "⇧" : "Shift");
  if (tokens.includes("$mod")) keycaps.push(applePlatform ? "⌘" : "Ctrl");
  keycaps.push(KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return keycaps;
}
