import type {
  ContentDatabaseBodyHydration,
  ContentDatabaseBodyHydrationSummary,
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

export function builderBodyHydrationDisplayHydratedCount(args: {
  summary: ContentDatabaseBodyHydrationSummary;
  highWaterCount?: number | null;
}) {
  const total = Math.max(0, args.summary.total);
  const unresolved = Math.max(
    0,
    args.summary.pending + args.summary.hydrating + args.summary.error,
  );
  const maxResolved = Math.max(0, total - unresolved);
  return Math.min(
    Math.max(args.summary.hydrated, args.highWaterCount ?? 0),
    unresolved > 0 ? maxResolved : total,
  );
}

export function databaseItemBodyHydrationIsPending(
  item: Pick<ContentDatabaseItem, "bodyHydration" | "document">,
) {
  const hydration =
    item.bodyHydration ?? item.document.databaseMembership?.bodyHydration;
  if (
    sourceBackedEmptyBodyNeedsHydration({
      sourceId: item.document.databaseMembership?.sourceId,
      content: item.document.content,
      hydration,
    })
  ) {
    return true;
  }
  return builderBodyHydrationIsPending(hydration);
}

export function documentBodyHydrationIsPending(
  document: Pick<Document, "content" | "databaseMembership">,
) {
  const hydration = document.databaseMembership?.bodyHydration;
  if (
    sourceBackedEmptyBodyNeedsHydration({
      sourceId: document.databaseMembership?.sourceId,
      content: document.content,
      hydration,
    })
  ) {
    return true;
  }
  return builderBodyHydrationIsPending(hydration);
}

export function previewBodyHydrationIsPending(args: {
  item: Pick<ContentDatabaseItem, "bodyHydration" | "document">;
  document: Pick<Document, "content" | "databaseMembership"> | null | undefined;
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

function sourceBackedEmptyBodyNeedsHydration(args: {
  sourceId: string | null | undefined;
  content: string | null | undefined;
  hydration: ContentDatabaseBodyHydration | null | undefined;
}) {
  if (!args.sourceId || !isEffectivelyEmptyDocumentContent(args.content)) {
    return false;
  }
  if (!args.hydration) return true;
  if (builderBodyHydrationIsPending(args.hydration)) return true;
  if (args.hydration.status === "error") return false;
  return args.hydration.status === "hydrated" && !args.hydration.version;
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
