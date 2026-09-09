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

export function searchHighlightParts(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  const lower = text.toLowerCase();
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > cursor)
      parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
