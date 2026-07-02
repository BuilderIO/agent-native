import type { ContentDatabaseSummary, DocumentSourceInfo } from "@shared/api";

export interface CommandSearchDocumentResult {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  snippet: string;
  contentLength: number;
  hideFromSearch: boolean;
  source?: DocumentSourceInfo;
  updatedAt: string;
}

export interface CommandSearchDocumentsResponse {
  documents: CommandSearchDocumentResult[];
}

export interface ContentCommandSearchGroups {
  documents: CommandSearchDocumentResult[];
  databases: ContentDatabaseSummary[];
  localFiles: CommandSearchDocumentResult[];
}

export function isLocalFileSearchResult(
  document: Pick<CommandSearchDocumentResult, "id" | "source">,
) {
  return (
    document.source?.mode === "local-files" ||
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
