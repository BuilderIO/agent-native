export type EditorMode = "annotate" | "edit" | "interact";

export type DesignTool =
  | "move"
  | "frame"
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "pen"
  | "hand"
  | "comment"
  | "draw"
  | "scale";

export type ShapeTool =
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star";

export type DesignLeftPanel =
  | "file"
  | "agent"
  | "assets"
  | "tools"
  | "tokens"
  | "import"
  | "code";

export const SHOW_DESIGN_CODE_LEFT_PANEL = true;
