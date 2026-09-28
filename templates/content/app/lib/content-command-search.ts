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
