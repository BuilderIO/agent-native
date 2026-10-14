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
    "draw",
    "scale",
  ],
);

export function normalizeDesignTool(value: unknown): DesignTool | null {
  // The Agent tool is retired; a stale URL or agent that still asks for it lands on Move.
  const tool = value === "agent" ? "move" : value;
  return typeof tool === "string" && DESIGN_EDITOR_TOOLS.has(tool as DesignTool)
    ? (tool as DesignTool)
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

/**
 * `loading` is the stretch before the Labs answer arrives. It reads as off, but
 * a request that needs the lab waits for the answer instead of being refused.
 */
export type AnnotateLabStatus = "on" | "off" | "loading";

/** Annotate mode exists only while its lab is on; a request for it lands on Design. */
export function resolveModeForAnnotateLab(
  mode: EditorMode,
  lab: AnnotateLabStatus,
): EditorMode {
  return mode === "annotate" && lab !== "on" ? "edit" : mode;
}

/** A request for Draw while the Annotate lab is off lands on Move. */
export function resolveAvailableTool(
  tool: DesignTool,
  lab: AnnotateLabStatus,
): DesignTool {
  return tool === "draw" && lab !== "on" ? "move" : tool;
}

/**
 * What to clear when the lab turns off under an open editor: the Draw tool and
 * overlay it owned, and Annotate mode unless a comment pin is the reason for it.
 * Null while there is nothing left over (and while the lab is still loading).
 */
export function resolveDrawStateWithoutLab(args: {
  annotateLab: AnnotateLabStatus;
  activeTool: DesignTool;
  drawMode: boolean;
  pinMode: boolean;
}): { dropAnnotateMode: boolean } | null {
  if (args.annotateLab !== "off") return null;
  if (args.activeTool !== "draw" && !args.drawMode) return null;
  return { dropAnnotateMode: !args.pinMode };
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

/** Whether a restored URL or agent `navigate` command asks for Annotate or Draw. */
export function commandRequestsAnnotate(command: {
  mode?: unknown;
  tool?: unknown;
}): boolean {
  return (
    normalizeDesignMode(command.mode) === "annotate" ||
    normalizeDesignTool(command.tool) === "draw"
  );
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

/**
 * The keyboard entries into annotate mode. Commenting needs the comment
 * capability; drawing also needs the Annotate lab and edit rights.
 */
export function annotationHotkeyHandlers<Handler>({
  canEditDesign,
  canCommentDesign,
  annotateLab,
  onComment,
  onDraw,
}: {
  canEditDesign: boolean;
  canCommentDesign: boolean;
  annotateLab: AnnotateLabStatus;
  onComment: Handler;
  onDraw: Handler;
}): { onCommentTool: Handler | undefined; onDrawTool: Handler | undefined } {
  return {
    onCommentTool: canCommentDesign ? onComment : undefined,
    onDrawTool:
      annotateLab === "on" && canEditDesign && canCommentDesign
        ? onDraw
        : undefined,
  };
}
