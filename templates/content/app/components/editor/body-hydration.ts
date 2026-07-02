import type {
  ContentDatabaseBodyHydration,
  ContentDatabaseItem,
  Document,
} from "@shared/api";

export function builderBodyHydrationIsPending(
  hydration: ContentDatabaseBodyHydration | null | undefined,
) {
  return !!hydration && hydration.status !== "hydrated";
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

export function previewBodyHydrationIsPending(args: {
  item: Pick<ContentDatabaseItem, "bodyHydration" | "document">;
  document: Pick<Document, "databaseMembership"> | null | undefined;
}) {
  return (
    databaseItemBodyHydrationIsPending(args.item) ||
    (args.document ? documentBodyHydrationIsPending(args.document) : false)
  );
}

export function isEffectivelyEmptyDocumentContent(
  content: string | null | undefined,
) {
  const normalized = (content ?? "").trim();
  return normalized === "" || normalized === "<empty-block/>";
}

export function shouldIgnorePreviewEmptyNormalization(args: {
  currentContent: string | null | undefined;
  nextContent: string | null | undefined;
}) {
  return (
    isEffectivelyEmptyDocumentContent(args.currentContent) &&
    isEffectivelyEmptyDocumentContent(args.nextContent)
  );
}
