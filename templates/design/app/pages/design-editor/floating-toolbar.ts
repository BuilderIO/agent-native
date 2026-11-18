import type { DesignTool, EditorMode, ShapeTool } from "./types";

export type ToolbarGroupId =
  | "move"
  | "frame"
  | "shapes"
  | "text"
  | "pen"
  | "comment";

/**
 * Interact browses the running app and nothing in it is selectable, so no tool
 * applies there. Comment needs a signed-in commenter; a widget's write ticket
 * does not cover it.
 */
export function getToolbarGroups(
  mode: EditorMode,
  { canComment }: { canComment: boolean },
): ToolbarGroupId[] {
  if (mode === "interact") return [];
  return [
    "move",
    "frame",
    "shapes",
    "text",
    "pen",
    ...(canComment ? (["comment"] as const) : []),
  ];
}

/** What the Frame group's main button can arm: Frame, or Screen (Frame drawing a Screen). */
export type FrameGroupTool = "frame" | "screen";

/** What the Pen group's main button can arm. */
export type PenGroupTool = "pen";

const SHAPE_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>([
  "rect",
  "line",
  "arrow",
  "ellipse",
  "polygon",
  "star",
]);

export function isShapeTool(tool: DesignTool): tool is ShapeTool {
  return SHAPE_TOOLS.has(tool);
}

/** The Frame-group tool the active tool corresponds to, or null for another group's. */
export function getActiveFrameGroupTool(
  activeTool: DesignTool,
  frameToolDraws: FrameGroupTool,
): FrameGroupTool | null {
  return activeTool === "frame" ? frameToolDraws : null;
}

/** The Shapes-group tool the active tool corresponds to, or null for another group's. */
export function getActiveShapeGroupTool(
  activeTool: DesignTool,
): ShapeTool | null {
  return isShapeTool(activeTool) ? activeTool : null;
}

/** The Pen-group tool the active tool corresponds to, or null for another group's. */
export function getActivePenGroupTool(
  activeTool: DesignTool,
): PenGroupTool | null {
  return activeTool === "pen" ? "pen" : null;
}

/**
 * What a group's main button shows and arms: the tool in use, and once drawing
 * is over (the canvas is back on Move) the one used last, unarmed, so a second
 * click draws another of the same.
 */
export function resolveGroupTool<Tool extends string>({
  active,
  lastUsed,
  available,
}: {
  active: Tool | null;
  lastUsed: Tool;
  available: readonly Tool[];
}): { tool: Tool; armed: boolean } {
  if (active !== null) return { tool: active, armed: true };
  return {
    tool: available.includes(lastUsed) ? lastUsed : available[0]!,
    armed: false,
  };
}
