import type { Document } from "@shared/api";

export function directoryWidgetEditability(
  document: Pick<
    Document,
    | "canEdit"
    | "mcpDirectoryWidgetReadOnly"
    | "mcpDirectoryWidgetCanEditDocument"
    | "mcpDirectoryWidgetCanEditDatabaseRows"
  >,
) {
  const isDirectoryWidget = document.mcpDirectoryWidgetReadOnly === true;
  return {
    canEditDocument:
      document.canEdit === true &&
      (!isDirectoryWidget ||
        document.mcpDirectoryWidgetCanEditDocument === true),
    canEditDatabaseRows:
      document.canEdit === true &&
      isDirectoryWidget &&
      document.mcpDirectoryWidgetCanEditDatabaseRows === true,
  };
}
