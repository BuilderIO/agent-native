export interface DocumentQueryContext {
  databaseId?: string | null;
  databaseDocumentId?: string | null;
}

export function documentQueryKey(
  documentId: string,
  context: DocumentQueryContext = {},
) {
  return [
    "action",
    "get-document",
    {
      id: documentId,
      ...(context.databaseId ? { databaseId: context.databaseId } : {}),
      ...(context.databaseDocumentId
        ? { databaseDocumentId: context.databaseDocumentId }
        : {}),
    },
  ] as const;
}

export function documentQueryFilter(documentId: string) {
  return {
    queryKey: ["action", "get-document"] as const,
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const args = query.queryKey[2];
      return (
        !!args &&
        typeof args === "object" &&
        "id" in args &&
        args.id === documentId
      );
    },
  };
}
