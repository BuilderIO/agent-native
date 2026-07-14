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

/** Zoom percentage applied when entering single-screen (focused) editor mode. */
export const FOCUSED_SCREEN_ZOOM = 100;

export interface DesignFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type DesignAccessRole = "owner" | "admin" | "editor" | "viewer";

export interface DesignData {
  id: string;
  title: string;
  description?: string;
  projectType: string;
  designSystemId?: string | null;
  data?: string | null;
  accessRole?: DesignAccessRole;
  files: DesignFile[];
}
