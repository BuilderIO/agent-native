import type { Document } from "@shared/api";

export type SidebarCommandId = "rename" | "move" | "preview";
export type SidebarCommandReason =
  | "readOnly"
  | "sourceUnsupported"
  | "typeUnsupported";

export function sidebarWriteCommandReason(
  document: Document,
): SidebarCommandReason | null {
  if (document.canEdit !== true) return "readOnly";
  if (document.source?.mode === "local-files" || document.notionPageId) {
    return "sourceUnsupported";
  }
  if (document.database) return "typeUnsupported";
  return null;
}

export function sidebarMoveTargets(documents: Document[], source: Document) {
  const descendants = new Set([source.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const document of documents) {
      if (
        document.parentId &&
        descendants.has(document.parentId) &&
        !descendants.has(document.id)
      ) {
        descendants.add(document.id);
        changed = true;
      }
    }
  }
  return documents.filter(
    (document) =>
      !descendants.has(document.id) &&
      sidebarWriteCommandReason(document) === null &&
      document.visibility === source.visibility,
  );
}
