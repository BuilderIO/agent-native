const COMMENT_MUTATIONS = new Set([
  "add-comment",
  "delete-comment",
  "sync-notion-comments",
  "update-comment",
]);

const DOCUMENT_BODY_MUTATIONS = new Set([
  "create-and-link-notion-page",
  "delete-document",
  "delete-document-property",
  "edit-document",
  "migrate-content-database-rows",
  "mutate-content-database-block",
  "pull-notion-page",
  "push-notion-page",
  "resolve-notion-sync-conflict",
  "restore-document",
  "restore-document-version",
  "set-document-property",
  "set-image-alt-text",
  "sync-local-folder-source",
  "transcribe-media",
  "update-document",
]);

interface ActionQueryFilter {
  queryKey: string[];
  type: "active";
  predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
}

function queryTargetsDocument(
  query: { queryKey: readonly unknown[] },
  documentId: string,
): boolean {
  const args = query.queryKey[2];
  return (
    !!args &&
    typeof args === "object" &&
    (("id" in args && args.id === documentId) ||
      ("documentId" in args && args.documentId === documentId))
  );
}

export function contentDocumentIdFromPathname(
  pathname: string,
): string | undefined {
  const match = /^\/page\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function contentActionRefreshPrefixes(
  event: {
    source?: string;
    key?: string;
    requestSource?: string;
  },
  browserTabId: string,
): string[][] {
  if (
    event.source !== "action" ||
    !event.key ||
    event.requestSource === browserTabId
  ) {
    return [];
  }
  if (COMMENT_MUTATIONS.has(event.key)) {
    return [["action", "list-comments"]];
  }
  if (DOCUMENT_BODY_MUTATIONS.has(event.key)) {
    return [["action", "get-document"]];
  }
  return [];
}

export function refreshContentActionQueries(
  queryClient: {
    refetchQueries: (
      filters: ActionQueryFilter,
      options: { cancelRefetch: false },
    ) => unknown;
  },
  event: { source?: string; key?: string; requestSource?: string },
  browserTabId: string,
  documentId?: string,
): void {
  for (const queryKey of contentActionRefreshPrefixes(event, browserTabId)) {
    const filters: ActionQueryFilter = { queryKey, type: "active" };
    if (documentId) {
      filters.predicate = (query) => queryTargetsDocument(query, documentId);
    }
    void queryClient.refetchQueries(filters, { cancelRefetch: false });
  }
}
