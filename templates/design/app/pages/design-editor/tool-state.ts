import type { CreationTool } from "@/components/design/design-canvas/creation";

import {
  isDesignLeftPanelEnabled,
  type DesignLeftPanel,
  type DesignTool,
  type EditorMode,
} from "./types";

export function normalizeDesignLeftPanel(
  value: unknown,
): DesignLeftPanel | undefined {
  if (value === "extensions") {
    return isDesignLeftPanelEnabled("tools") ? "tools" : undefined;
  }
  if (value === "tokens") return "library";
  return isDesignLeftPanelEnabled(value) ? value : undefined;
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

export const DESIGN_EDITOR_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>(
  [
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
    "scale",
  ],
);

export function normalizeDesignTool(value: unknown): DesignTool | null {
  // The Agent and Draw tools are retired; a stale URL or agent that still asks for one lands on Move.
  const tool = value === "agent" || value === "draw" ? "move" : value;
  return typeof tool === "string" && DESIGN_EDITOR_TOOLS.has(tool as DesignTool)
    ? (tool as DesignTool)
    : null;
}

// Comment mode belongs to the comment pin tool, so a restored URL or agent
// request cannot ask for it by name; it asks for the tool instead.
const DESIGN_EDITOR_MODES = new Set<EditorMode>(["edit", "interact"]);

export function normalizeDesignMode(value: unknown): EditorMode | null {
  return typeof value === "string" &&
    DESIGN_EDITOR_MODES.has(value as EditorMode)
    ? (value as EditorMode)
    : null;
}

export function commentModeReturnOptions(
  mode: EditorMode,
  activeFileId: string | null | undefined,
): CommentModeReturnOptions | null {
  return mode === "interact" && activeFileId
    ? { targetFileId: activeFileId, keepInteractDevice: true }
    : null;
}

export interface CommentModeReturnOptions {
  targetFileId: string;
  keepInteractDevice: true;
}

export function resolveCommentModeExit(
  returnOptions: CommentModeReturnOptions | null,
  screenIds: ReadonlySet<string>,
  fileIds: ReadonlySet<string>,
): { mode: "interact"; options: CommentModeReturnOptions } | { mode: "edit" } {
  if (
    returnOptions &&
    screenIds.has(returnOptions.targetFileId) &&
    fileIds.has(returnOptions.targetFileId)
  ) {
    return { mode: "interact", options: returnOptions };
  }
  return { mode: "edit" };
}

/**
 * Commenting is a canvas-mode feature: Interact shows no pins, threads or
 * placement UI whatever the "show comments" view setting says.
 */
export function areCommentPinsHidden(args: {
  commentsHidden: boolean;
  mode: EditorMode;
}): boolean {
  return args.commentsHidden || args.mode === "interact";
}

export function resolveToolAfterSelection(current: DesignTool): DesignTool {
  return current === "scale" ? current : "move";
}

export function resolveSpaceForwardTransition(
  event: "keydown" | "keyup" | "blur",
  armed: boolean,
  dragActive: boolean,
): { armed: boolean; broadcast: boolean | null } {
  if (event === "keydown") {
    return dragActive
      ? { armed: true, broadcast: true }
      : { armed, broadcast: null };
  }
  return armed
    ? { armed: false, broadcast: false }
    : { armed, broadcast: null };
}

export function isSingleScreenAnnotationTool(tool: DesignTool): boolean {
  return tool === "comment";
}

export function getDesignToolActivationState(tool: DesignTool): {
  mode: EditorMode;
  pinMode: boolean;
} {
  if (tool === "comment") {
    return { mode: "comment", pinMode: true };
  }
  return { mode: "edit", pinMode: false };
}

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

export function shouldRevealLayersOnFirstCreate(args: {
  activeLeftPanel: DesignLeftPanel | null;
  alreadyRevealed: boolean;
}): boolean {
  if (args.alreadyRevealed) return false;
  return args.activeLeftPanel !== "file";
}

export function shouldAskOnNewDesignArrival(args: {
  arrivedFromNewDesign: boolean;
  alreadyAsked: boolean;
  canEditDesign: boolean;
  embedded: boolean;
  shellMode: boolean;
}): boolean {
  if (!args.arrivedFromNewDesign || args.alreadyAsked) return false;
  if (args.shellMode || args.embedded) return false;
  return args.canEditDesign;
}

export function getDesignBottomToolbarMode(args: {
  isSignedIn: boolean;
  canEditDesign: boolean;
  canCommentDesign: boolean;
  hasActiveFile: boolean;
  /** A widget's write ticket authorizes editing without a signed-in session. */
  scopedWidget: boolean;
}): DesignBottomToolbarMode {
  if (args.scopedWidget && args.canEditDesign) return "editor";
  if (!args.isSignedIn || !args.canCommentDesign) return "hidden";
  if (args.canEditDesign) return "editor";
  return args.hasActiveFile ? "commenter" : "hidden";
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
