import type { ContentDatabaseSummary } from "@shared/api";

export interface CommandSearchDocumentResult {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  snippet: string;
  contentLength: number;
  hideFromSearch: boolean;
  updatedAt: string;
}

export interface CommandSearchDocumentsPagination {
  offset: number;
  limit: number;
  totalItems: number;
  returnedItems: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface CommandSearchDocumentsResponse {
  documents: CommandSearchDocumentResult[];
  pagination: CommandSearchDocumentsPagination;
}

export interface CommandSearchDocumentPages {
  nextOffset: number;
  documents: CommandSearchDocumentResult[];
}

export const COMMAND_SEARCH_PAGE_LIMIT = 8;

// Pages are followed until the accumulated visible results top the display
// budget: a first page that lands exactly on the budget still pulls one more
// page, so matches just past it stay reachable instead of being cut off at
// the first eight. Hidden rows (filtered for display as a safety net) never
// count toward the budget.
export function mergeContentCommandSearchPage(
  current: CommandSearchDocumentPages,
  response: CommandSearchDocumentsResponse,
): CommandSearchDocumentPages {
  const documentIds = new Set(current.documents.map((document) => document.id));
  const documents = [
    ...current.documents,
    ...response.documents.filter((document) => !documentIds.has(document.id)),
  ];
  const visibleCount = documents.filter(
    (document) => !document.hideFromSearch,
  ).length;
  const { hasMore, nextOffset, offset } = response.pagination;

  return {
    nextOffset:
      hasMore &&
      nextOffset !== null &&
      visibleCount <= COMMAND_SEARCH_PAGE_LIMIT
        ? nextOffset
        : offset,
    documents,
  };
}

export interface ContentCommandSearchGroups {
  documents: CommandSearchDocumentResult[];
  databases: ContentDatabaseSummary[];
  localFiles: CommandSearchDocumentResult[];
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

export function groupContentCommandSearchResults(args: {
  documents: CommandSearchDocumentResult[];
  databases: ContentDatabaseSummary[];
  query: string;
}): ContentCommandSearchGroups {
  const needle = args.query.trim().toLowerCase();
  const visibleDocuments = args.documents.filter(
    (document) => !document.hideFromSearch,
  );
  const matchingDatabases = needle
    ? args.databases
        .filter((database) => database.title.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];
  const databaseDocumentIds = new Set(
    matchingDatabases.map((database) => database.documentId),
  );

  return {
    documents: visibleDocuments.filter(
      (document) =>
        !isLocalFileSearchResult(document) &&
        !databaseDocumentIds.has(document.id),
    ),
    databases: matchingDatabases,
    localFiles: visibleDocuments.filter(isLocalFileSearchResult),
  };
}
