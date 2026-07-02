import type {
  ContentDatabaseBodyHydration,
  ContentDatabaseItem,
  Document,
} from "@shared/api";

export function builderBodyHydrationIsPending(
  hydration: ContentDatabaseBodyHydration | null | undefined,
) {
  return hydration?.status === "pending" || hydration?.status === "hydrating";
}

export function databaseItemBodyHydrationIsPending(
  item: Pick<ContentDatabaseItem, "bodyHydration" | "document">,
) {
  return builderBodyHydrationIsPending(
    item.bodyHydration ?? item.document.databaseMembership?.bodyHydration,
  );
}

export function documentBodyHydrationIsPending(
  document: Pick<Document, "databaseMembership">,
) {
  return builderBodyHydrationIsPending(
    document.databaseMembership?.bodyHydration,
  );
}
