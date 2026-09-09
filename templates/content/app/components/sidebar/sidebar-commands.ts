import type { Document } from "@shared/api";

export type SidebarCommandId = "rename" | "move" | "preview" | "duplicate";
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

export function sidebarDuplicateErrorKey(error: unknown) {
  const code =
    error && typeof error === "object" && "errorCode" in error
      ? error.errorCode
      : null;
  if (code === "DUPLICATE_LIMIT") return "sidebarCommands.duplicateLimit";
  if (
    [
      "SOURCE_DUPLICATION_UNSUPPORTED",
      "PAGE_TREE_REQUIRED",
      "AMBIGUOUS_DATABASE_PARENT",
      "UNSUPPORTED_DUPLICATE_PAYLOAD",
      "PROPERTY_UNAVAILABLE",
      "INVALID_PAGE_TREE",
    ].includes(String(code))
  )
    return "sidebarCommands.duplicateUnsupported";
  if (
    [
      "PAGE_UNAVAILABLE",
      "PAGE_TREE_UNAVAILABLE",
      "SPACE_CREATION_DENIED",
      "SPACE_REQUIRED",
      "FILES_UNAVAILABLE",
    ].includes(String(code))
  )
    return "sidebarCommands.duplicateDenied";
  return "sidebarCommands.failed";
}
