export type EditorMode = "comment" | "edit" | "interact";

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
  | "library"
  | "threads";

const designSecondaryLeftPanelsSetting =
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: Record<string, string> }).env
        ?.VITE_SHOW_DESIGN_SECONDARY_LEFT_PANELS
    : undefined;
export const SHOW_DESIGN_SECONDARY_LEFT_PANELS =
  designSecondaryLeftPanelsSetting === "1" ||
  designSecondaryLeftPanelsSetting === "true";

export function isDesignLeftPanelEnabled(
  value: unknown,
): value is DesignLeftPanel {
  if (
    value !== "file" &&
    value !== "agent" &&
    value !== "assets" &&
    value !== "tools" &&
    value !== "library" &&
    value !== "threads"
  ) {
    return false;
  }

  if (value === "assets" || value === "tools") {
    return SHOW_DESIGN_SECONDARY_LEFT_PANELS;
  }
  return true;
}

export const FOCUSED_SCREEN_ZOOM = 100;

export interface DesignFileMetadata {
  id: string;
  filename: string;
  fileType: string;
  contentBytes?: number | null;
  createdAt: string | null;
  updatedAt: string;
}

export interface DesignFile extends DesignFileMetadata {
  content: string;
  sourceState?: "unloaded" | "loading" | "deferred" | "ready" | "error";
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
  liveCollaborationEnabled?: boolean;
  visibility?: "private" | "org" | "public";
  data?: string | null;
  accessRole?: DesignAccessRole;
  canPersistSource?: boolean;
  files: DesignFile[];
}
