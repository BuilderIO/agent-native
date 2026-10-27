import type { ActionRunContext } from "@agent-native/core/action";

export function contentWidgetEditCapabilities(
  context: ActionRunContext | undefined,
  document: {
    id: string;
    spaceId?: string | null;
    databaseId?: string | null;
    databaseDocumentId?: string | null;
  },
) {
  const grant = context?.mcpDirectoryWidgetWrite;
  if (
    context?.mcpDirectoryWidgetReadOnly !== true ||
    grant?.appId !== "content"
  ) {
    return { canEditDocument: false, canEditDatabaseRows: false };
  }

  const sameSpace =
    !grant.resourceIds.spaceId ||
    grant.resourceIds.spaceId === document.spaceId;
  const canEditDocument =
    sameSpace &&
    grant.resourceIds.documentId === document.id &&
    grant.actionNames.includes("update-document");
  const canEditDatabaseRows =
    sameSpace &&
    !!grant.resourceIds.spaceId &&
    !!document.databaseId &&
    !!document.databaseDocumentId &&
    grant.resourceIds.databaseId === document.databaseId &&
    grant.resourceIds.databaseDocumentId === document.databaseDocumentId &&
    grant.actionNames.some((actionName) =>
      ["add-database-item", "update-database-item"].includes(actionName),
    );

  return { canEditDocument, canEditDatabaseRows };
}
