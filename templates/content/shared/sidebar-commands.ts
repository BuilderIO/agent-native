export type SidebarCommandWriteReason =
  | "readOnly"
  | "sourceUnsupported"
  | "typeUnsupported";

export interface SidebarCommandsResponse {
  documentId: string;
  title: string;
  writeReason: SidebarCommandWriteReason | null;
  canMoveToRoot: boolean;
  destinations: Array<{ id: string; title: string; parentId: string | null }>;
}
