import type {
  ContentDatabaseBodyHydration,
  ContentDatabaseItem,
  Document,
} from "@shared/api";

export function builderBodyHydrationIsPending(
  hydration: ContentDatabaseBodyHydration | null | undefined,
) {
  return (
    !!hydration &&
    (hydration.status === "pending" || hydration.status === "hydrating")
  );
}

export function builderBodyHydrationIsTerminalError(
  hydration: ContentDatabaseBodyHydration | null | undefined,
) {
  return hydration?.status === "error";
}

export function databaseItemBodyHydrationIsPending(
  item: Pick<ContentDatabaseItem, "bodyHydration" | "document">,
) {
  if (
    item.document.databaseMembership?.sourceId &&
    !item.bodyHydration &&
    !item.document.databaseMembership.bodyHydration
  ) {
    return true;
  }
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
  const membership =
    args.document?.databaseMembership ?? args.item.document.databaseMembership;
  if (
    membership?.sourceId &&
    !args.document &&
    !args.item.bodyHydration &&
    !args.item.document.databaseMembership?.bodyHydration
  ) {
    return true;
  }
  return (
    databaseItemBodyHydrationIsPending(args.item) ||
    (args.document ? documentBodyHydrationIsPending(args.document) : false)
  );
}

export function previewBodyHydrationIsTerminalError(args: {
  item: Pick<ContentDatabaseItem, "bodyHydration" | "document">;
  document: Pick<Document, "databaseMembership"> | null | undefined;
}) {
  return (
    builderBodyHydrationIsTerminalError(
      args.document?.databaseMembership?.bodyHydration,
    ) ||
    builderBodyHydrationIsTerminalError(
      args.item.bodyHydration ??
        args.item.document.databaseMembership?.bodyHydration,
    )
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
