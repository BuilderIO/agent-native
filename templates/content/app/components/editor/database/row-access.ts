import type { ContentDatabaseItem, ContentDatabaseSource } from "@shared/api";

export function databaseItemIsSourceBacked(
  item: ContentDatabaseItem,
  sources: ContentDatabaseSource[],
) {
  const membershipHydration = item.document.databaseMembership?.bodyHydration;
  const hydration = item.bodyHydration ?? membershipHydration;
  return (
    item.sourceRecord !== undefined ||
    item.document.databaseMembership?.sourceId != null ||
    hydration?.version != null ||
    (hydration !== undefined && hydration.status !== "hydrated") ||
    sources.some((source) =>
      source.rows.some((row) => row.databaseItemId === item.id),
    )
  );
}
