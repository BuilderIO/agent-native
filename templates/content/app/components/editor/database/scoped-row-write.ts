import type {
  ContentDatabaseItem,
  ContentDatabaseMutationTarget,
  Document,
  UpdateDatabaseItemRequest,
} from "../../../../shared/api.js";

export function documentDatabaseWidgetEditProps(
  document: Pick<
    Document,
    "mcpDirectoryWidgetReadOnly" | "mcpDirectoryWidgetCanEditDatabaseRows"
  >,
  canEdit: boolean,
  canEditRowsOnly = false,
) {
  const isScopedWidget = document.mcpDirectoryWidgetReadOnly === true;
  return {
    canEdit: canEdit && !isScopedWidget,
    canEditRows:
      canEditRowsOnly &&
      isScopedWidget &&
      document.mcpDirectoryWidgetCanEditDatabaseRows === true,
  };
}

export function scopedDatabaseRowTitleUpdateRequest({
  item,
  target,
  expectedSchemaRevision,
  idempotencyKey,
  title,
}: {
  item: ContentDatabaseItem;
  target: ContentDatabaseMutationTarget;
  expectedSchemaRevision: string;
  idempotencyKey: string;
  title: string;
}): UpdateDatabaseItemRequest | null {
  const normalizedTitle = title.trim();
  if (
    !normalizedTitle ||
    !item.rowRevision ||
    item.databaseId !== target.databaseId
  ) {
    return null;
  }

  return {
    target,
    expectedSchemaRevision,
    idempotencyKey,
    itemId: item.id,
    documentId: item.document.id,
    expectedRowRevision: item.rowRevision,
    title: normalizedTitle,
  };
}
