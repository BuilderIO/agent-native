interface ActionQuery {
  queryKey: readonly unknown[];
}

interface ActionEvent {
  source?: string;
  key?: string;
}

const COMMENT_MUTATIONS = new Set([
  "add-comment",
  "delete-comment",
  "sync-notion-comments",
  "update-comment",
]);

const DOCUMENT_MUTATIONS = new Set([
  "create-and-link-notion-page",
  "delete-document",
  "delete-document-property",
  "duplicate-document-property",
  "edit-document",
  "execute-builder-source-batch",
  "execute-builder-source-execution",
  "import-content-source",
  "migrate-content-database-rows",
  "move-document",
  "mutate-content-database-block",
  "process-builder-body-hydration",
  "pull-builder-doc",
  "pull-document",
  "pull-notion-page",
  "push-builder-doc",
  "push-notion-page",
  "reorder-document-property",
  "resolve-local-folder-conflict",
  "resolve-notion-sync-conflict",
  "restore-document",
  "restore-document-version",
  "set-document-discoverability",
  "set-document-property",
  "set-image-alt-text",
  "sync-local-folder-source",
  "sync-manifest-local-folder-source",
  "transcribe-media",
  "update-document",
]);

const CONTENT_MUTATIONS = new Set([
  ...COMMENT_MUTATIONS,
  ...DOCUMENT_MUTATIONS,
]);

function queryTargetsDocument(query: ActionQuery, documentId: string): boolean {
  if (query.queryKey[0] !== "action") return false;
  if (
    query.queryKey[1] !== "get-document" &&
    query.queryKey[1] !== "list-comments"
  ) {
    return false;
  }
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

export function contentActionInvalidatePredicate(
  pathname: string,
): (query: ActionQuery, events: readonly ActionEvent[]) => boolean {
  const documentId = contentDocumentIdFromPathname(pathname);
  return (query, events) => {
    if (documentId === undefined || !queryTargetsDocument(query, documentId)) {
      return false;
    }
    return events.some(
      (event) =>
        event.source === "action" &&
        typeof event.key === "string" &&
        CONTENT_MUTATIONS.has(event.key),
    );
  };
}
