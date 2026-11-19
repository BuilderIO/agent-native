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
  document: Pick<Document, "content" | "bodyHydration">,
) {
  const hydration = document.bodyHydration?.hydration;
  if (
    sourceBackedEmptyBodyNeedsHydration({
      sourceId: document.bodyHydration ? "source-backed" : undefined,
      content: document.content,
      hydration,
    })
  ) {
    return true;
  }
  return builderBodyHydrationIsPending(hydration);
}

export function isEffectivelyEmptyDocumentContent(
  content: string | null | undefined,
) {
  const normalized = (content ?? "").trim();
  return (
    normalized === "" ||
    normalized.split(/\r?\n/).every((line) => {
      const trimmed = line.trim();
      return trimmed === "" || /^<empty-block\b[^>]*\/>$/.test(trimmed);
    })
  );
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
