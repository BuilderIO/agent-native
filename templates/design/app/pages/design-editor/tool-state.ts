import type { CreationTool } from "@/components/design/design-canvas/creation";

import {
  SHOW_DESIGN_CODE_LEFT_PANEL,
  type DesignLeftPanel,
  type DesignTool,
  type EditorMode,
} from "./types";

export function normalizeDesignLeftPanel(
  value: unknown,
): DesignLeftPanel | undefined {
  if (value === "extensions") return "tools";
  if (value === "code") {
    return SHOW_DESIGN_CODE_LEFT_PANEL ? "code" : undefined;
  }
  return value === "file" ||
    value === "agent" ||
    value === "assets" ||
    value === "tools" ||
    value === "tokens" ||
    value === "import"
    ? value
    : undefined;
}

export const MOVE_GROUP_TOOL_PRESENTATIONS = {
  move: {
    labelKey: "designEditor.tools.move",
    shortcut: "V",
  },
  hand: {
    labelKey: "designEditor.tools.hand",
    shortcut: "H",
  },
  scale: {
    labelKey: "designEditor.tools.scale",
    shortcut: "K",
  },
} as const;

export type MoveGroupTool = keyof typeof MOVE_GROUP_TOOL_PRESENTATIONS;

export function getMoveGroupToolPresentation(activeTool: DesignTool) {
  const moveGroupTool: MoveGroupTool =
    activeTool === "hand" || activeTool === "scale" ? activeTool : "move";
  return {
    tool: moveGroupTool,
    ...MOVE_GROUP_TOOL_PRESENTATIONS[moveGroupTool],
  };
}

const DESIGN_EDITOR_TOOLS = new Set<DesignTool>([
  "move",
  "frame",
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
  "text",
  "pen",
  "hand",
  "comment",
  "draw",
  "scale",
]);

export function normalizeDesignTool(value: unknown): DesignTool | null {
  return typeof value === "string" &&
    DESIGN_EDITOR_TOOLS.has(value as DesignTool)
    ? (value as DesignTool)
    : null;
}

const DESIGN_EDITOR_MODES = new Set<EditorMode>([
  "annotate",
  "edit",
  "interact",
]);

export function normalizeDesignMode(value: unknown): EditorMode | null {
  return typeof value === "string" &&
    DESIGN_EDITOR_MODES.has(value as EditorMode)
    ? (value as EditorMode)
    : null;
}

export function isSingleScreenAnnotationTool(tool: DesignTool): boolean {
  return tool === "draw" || tool === "comment";
}

export function getDesignToolActivationState(tool: DesignTool): {
  mode: EditorMode;
  drawMode: boolean;
  pinMode: boolean;
} {
  if (tool === "draw") {
    return { mode: "annotate", drawMode: true, pinMode: false };
  }
  if (tool === "comment") {
    return { mode: "annotate", drawMode: false, pinMode: true };
  }
  return { mode: "edit", drawMode: false, pinMode: false };
}

export function shouldAutoEnableDrawOverlay(args: {
  mode: EditorMode;
  activeTool: DesignTool;
  pinMode: boolean;
}): boolean {
  return (
    args.mode === "annotate" && args.activeTool === "draw" && !args.pinMode
  );
}

/**
 * There are only two views: the infinite canvas (where Edit and Annotate
 * live) and the focused responsive screen (where Interact lives). A mode
 * choice that disagrees with the current view is therefore a view change —
 * picking Edit or Annotate from a focused screen must return to the canvas,
 * not strand the screen in the forbidden single-screen editing state.
 */
export function resolveModeChangeView(args: {
  next: EditorMode;
  viewMode: "single" | "overview";
}): "enter-single-interact" | "enter-overview" | "stay" {
  if (args.next === "interact") {
    return args.viewMode === "overview" ? "enter-single-interact" : "stay";
  }
  return args.viewMode === "single" ? "enter-overview" : "stay";
}

export type DesignBottomToolbarMode = "editor" | "commenter" | "hidden";

export function getDesignBottomToolbarMode(args: {
  isSignedIn: boolean;
  canEditDesign: boolean;
  hasActiveFile: boolean;
}): DesignBottomToolbarMode {
  if (!args.isSignedIn || !args.hasActiveFile) return "hidden";
  return args.canEditDesign ? "editor" : "commenter";
}

export function getSingleScreenCreationTool(args: {
  activeTool: DesignTool;
  viewMode: "single" | "overview";
  hasActiveFile: boolean;
}): CreationTool | null {
  if (args.viewMode !== "single" || !args.hasActiveFile) return null;
  switch (args.activeTool) {
    case "rect":
      return "rectangle";
    case "ellipse":
    case "line":
    case "arrow":
    case "text":
    case "pen":
    case "frame":
      return args.activeTool;
    default:
      return null;
  }
}
