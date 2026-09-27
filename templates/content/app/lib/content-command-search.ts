import type { Document } from "@shared/api";

export interface CommandSearchDocumentResult {
  id: string;
  parentId: string | null;
  parentTitle: string | null;
  description: string;
  documentType: "page" | "database";
  sourceKind: string | null;
  sourceUpdatedAt: string | null;
  title: string;
  icon: string | null;
  snippet: string;
  contentLength: number;
  hideFromSearch: boolean;
  updatedAt: string;
}

export interface CommandSearchDocumentsResponse {
  documents: CommandSearchDocumentResult[];
  pagination: {
    offset: number;
    limit: number;
    totalItems: number;
    returnedItems: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export function isLocalFileSearchResult(
  document: Pick<CommandSearchDocumentResult, "id">,
) {
  return (
    document.id.startsWith("local-file:") ||
    document.id.startsWith("local-folder:")
  );
}

export function contentCommandDocumentPath(documentId: string) {
  return `/page/${documentId}`;
}

export function searchHighlightParts(text: string, needles: string[]) {
  const candidates = [
    ...new Set(
      needles.map((needle) => needle.trim().toLowerCase()).filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!candidates.length || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const marks: { start: number; end: number }[] = [];
  for (const needle of candidates) {
    let index = lower.indexOf(needle);
    while (index !== -1) {
      marks.push({ start: index, end: index + needle.length });
      index = lower.indexOf(needle, index + needle.length);
    }
  }
  if (!marks.length) return [{ text, match: false }];
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.end <= cursor) continue;
    if (mark.start > cursor)
      parts.push({ text: text.slice(cursor, mark.start), match: false });
    parts.push({ text: text.slice(mark.start, mark.end), match: true });
    cursor = mark.end;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

// ---------------------------------------------------------------------------
// Instant (browser) title lane
//
// The sidebar's already-loaded document list (`useDocuments()` /
// `LIST_DOCUMENTS_QUERY_KEY`) lets the picker answer a title search from data
// already in memory, before the debounced `search-documents` request lands.
// These pure helpers filter that list down to what the server would also
// consider eligible and in-scope, and merge it with the server's results once
// they arrive for the *current* query: the server's own order wins for what
// it returns, so the list converges rather than staying pinned to a browser
// guess (see `mergeInstantAndServerResults`).
// ---------------------------------------------------------------------------

export function documentDisplayType(
  document: Pick<Document, "database">,
): "page" | "database" {
  return document.database ? "database" : "page";
}

/**
 * Mirrors the one eligibility rule `search-documents` applies beyond plain
 * access control when a text `query` is given (actions/search-documents.ts,
 * the `args.query ? or(eq(hideFromSearch, 0), isNull(hideFromSearch)) : ...`
 * clause): a document hidden from search never appears in keyword search
 * results, regardless of ownership or visibility. Trashed documents need no
 * check here — `list-documents` (and so `useDocuments()`) already excludes
 * them via the same `isNull(trashedAt)` clause `search-documents` uses
 * (actions/_document-discovery-query.ts), so one never reaches this filter.
 */
export function documentEligibleForInstantSearch(
  document: Pick<Document, "hideFromSearch">,
): boolean {
  return !document.hideFromSearch;
}

export function documentMatchesModifiedAfter(
  document: Pick<Document, "updatedAt">,
  modifiedAfter: string | undefined,
): boolean {
  if (!modifiedAfter) return true;
  const updated = Date.parse(document.updatedAt);
  const boundary = Date.parse(modifiedAfter);
  if (!Number.isFinite(updated) || !Number.isFinite(boundary)) return false;
  return updated >= boundary;
}

/**
 * Maps every document to its topmost loaded ancestor, so scope filtering can
 * ask "is this document under this space's root?" without a per-document
 * `spaceId` field (list-documents doesn't return one). Memoize per
 * document-list change; the result is reused for every keystroke.
 */
export function buildDocumentSpaceRootIndex(
  documents: readonly Pick<Document, "id" | "parentId">[],
): ReadonlyMap<string, string> {
  const parentOf = new Map(
    documents.map((document) => [document.id, document.parentId ?? null]),
  );
  const roots = new Map<string, string>();
  for (const document of documents) {
    if (roots.has(document.id)) continue;
    const chain: string[] = [];
    const chainSet = new Set<string>();
    let current = document.id;
    for (;;) {
      const cached = roots.get(current);
      if (cached) {
        for (const id of chain) roots.set(id, cached);
        break;
      }
      if (chainSet.has(current)) {
        // Cycle: stop it from being its own ancestor forever.
        roots.set(current, current);
        for (const id of chain) roots.set(id, current);
        break;
      }
      chain.push(current);
      chainSet.add(current);
      const parentId = parentOf.get(current);
      if (!parentId || !parentOf.has(parentId)) {
        roots.set(current, current);
        for (const id of chain) roots.set(id, current);
        break;
      }
      current = parentId;
    }
  }
  return roots;
}

export function documentSpaceRootIds(space: {
  filesDocumentId: string;
  catalogDocumentId: string;
}): ReadonlySet<string> {
  return new Set([space.filesDocumentId, space.catalogDocumentId]);
}

/**
 * True only when membership is positively confirmed. An ancestor chain that
 * doesn't resolve to a known root of `spaceRootIds` is left out rather than
 * guessed at — the server lane still returns it if it truly belongs.
 */
export function documentMatchesSelectedScope(args: {
  documentId: string;
  rootIndex: ReadonlyMap<string, string>;
  spaceRootIds: ReadonlySet<string>;
}): boolean {
  if (args.spaceRootIds.has(args.documentId)) return true;
  const root = args.rootIndex.get(args.documentId);
  return root !== undefined && args.spaceRootIds.has(root);
}

export interface InstantSearchFilters {
  searchingAll: boolean;
  spaceRootIds: ReadonlySet<string> | null;
  rootIndex: ReadonlyMap<string, string>;
  documentType?: "page" | "database";
  modifiedAfter?: string;
}

export function documentPassesInstantSearchFilters(
  document: Document,
  filters: InstantSearchFilters,
): boolean {
  if (!documentEligibleForInstantSearch(document)) return false;
  if (
    filters.documentType &&
    documentDisplayType(document) !== filters.documentType
  ) {
    return false;
  }
  if (!documentMatchesModifiedAfter(document, filters.modifiedAfter)) {
    return false;
  }
  if (!filters.searchingAll) {
    if (!filters.spaceRootIds) return false;
    if (
      !documentMatchesSelectedScope({
        documentId: document.id,
        rootIndex: filters.rootIndex,
        spaceRootIds: filters.spaceRootIds,
      })
    ) {
      return false;
    }
  }
  return true;
}

export function documentToInstantSearchResult(
  document: Document,
): CommandSearchDocumentResult {
  return {
    id: document.id,
    parentId: document.parentId,
    // Left for the server merge to fill in: revealing a parent title here
    // would require redoing the server's own access redaction locally.
    parentTitle: null,
    description: document.description ?? "",
    documentType: documentDisplayType(document),
    sourceKind: document.source?.kind ?? null,
    sourceUpdatedAt: document.source?.updatedAt ?? null,
    title: document.title,
    icon: null,
    snippet: "",
    contentLength: 0,
    hideFromSearch: document.hideFromSearch,
    updatedAt: document.updatedAt,
  };
}

/**
 * Adopts the server's own order for every document it returned — once the
 * server lane answers for the current query, the list converges on it rather
 * than staying pinned to the instant lane's guess — then appends whatever the
 * instant lane matched that the server didn't return (e.g. its browser-only
 * fuzzy tier), deduped by id. Before the server has answered, `server` is
 * empty and this is just the instant lane's own order.
 */
export function mergeInstantAndServerResults(
  instant: readonly CommandSearchDocumentResult[],
  server: readonly CommandSearchDocumentResult[],
): CommandSearchDocumentResult[] {
  const serverIds = new Set(server.map((document) => document.id));
  return [
    ...server,
    ...instant.filter((document) => !serverIds.has(document.id)),
  ];
}

/** For Next/Previous server pages, which the instant lane never contributes to. */
export function excludeAlreadyShownDocuments(
  documents: readonly CommandSearchDocumentResult[],
  shownIds: ReadonlySet<string>,
): CommandSearchDocumentResult[] {
  return documents.filter((document) => !shownIds.has(document.id));
}
