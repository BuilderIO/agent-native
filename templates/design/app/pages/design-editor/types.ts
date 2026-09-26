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

const designSecondaryLeftPanelsSetting =
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: Record<string, string> }).env
        ?.VITE_SHOW_DESIGN_SECONDARY_LEFT_PANELS
    : undefined;
export const SHOW_DESIGN_SECONDARY_LEFT_PANELS =
  designSecondaryLeftPanelsSetting === "1" ||
  designSecondaryLeftPanelsSetting === "true";
export const SHOW_DESIGN_CODE_LEFT_PANEL = SHOW_DESIGN_SECONDARY_LEFT_PANELS;

export function isDesignLeftPanelEnabled(
  value: unknown,
): value is DesignLeftPanel {
  if (
    value !== "file" &&
    value !== "agent" &&
    value !== "assets" &&
    value !== "tools" &&
    value !== "tokens" &&
    value !== "import" &&
    value !== "code"
  ) {
    return false;
  }

  if (value === "code") return SHOW_DESIGN_CODE_LEFT_PANEL;
  if (value === "assets" || value === "tools" || value === "tokens") {
    return SHOW_DESIGN_SECONDARY_LEFT_PANELS;
  }
  return true;
}

export const FOCUSED_SCREEN_ZOOM = 100;

export interface DesignFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type DesignAccessRole =
  | "owner"
  | "admin"
  | "editor"
  | "commenter"
  | "viewer";

export interface DesignData {
  id: string;
  title: string;
  updatedAt: string;
  description?: string;
  projectType: string;
  designSystemId?: string | null;
  liveCollaborationEnabled?: boolean;
  visibility?: "private" | "org" | "public";
  data?: string | null;
  accessRole?: DesignAccessRole;
  files: DesignFile[];
}
