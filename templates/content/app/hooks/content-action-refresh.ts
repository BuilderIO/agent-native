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
  const actionName = query.queryKey[1];
  const args = query.queryKey[2];
  if (!args || typeof args !== "object") return false;
  if (actionName === "get-document") {
    return "id" in args && args.id === documentId;
  }
  if (
    actionName === "list-comments" ||
    actionName === "list-comment-ai-requests"
  ) {
    return "documentId" in args && args.documentId === documentId;
  }
  return (
    actionName === "list-resource-suggestions" &&
    "resourceType" in args &&
    args.resourceType === "document" &&
    "resourceId" in args &&
    args.resourceId === documentId
  );
}

function queryActionName(query: ActionQuery): string | undefined {
  return query.queryKey[0] === "action" && typeof query.queryKey[1] === "string"
    ? query.queryKey[1]
    : undefined;
}

function eventRefreshesQuery(eventKey: string, queryAction: string): boolean {
  if (CONTENT_MUTATIONS.has(eventKey)) {
    return queryAction === "get-document" || queryAction === "list-comments";
  }
  if (eventKey === "start-comment-ai-request") {
    return queryAction === "list-comment-ai-requests";
  }
  if (
    eventKey === "reply-to-comment-ai-request" ||
    eventKey === "create-comment-ai-suggestion"
  ) {
    return (
      queryAction === "list-comments" ||
      queryAction === "list-comment-ai-requests" ||
      queryAction === "list-resource-suggestions"
    );
  }
  if (eventKey === "apply-comment-ai-request") {
    return (
      queryAction === "get-document" ||
      queryAction === "list-comments" ||
      queryAction === "list-comment-ai-requests" ||
      queryAction === "list-resource-suggestions"
    );
  }
  if (eventKey === "decide-resource-suggestion") {
    return (
      queryAction === "get-document" ||
      queryAction === "list-resource-suggestions"
    );
  }
  return false;
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
    const actionName = queryActionName(query);
    if (!actionName) return false;
    return events.some(
      (event) =>
        event.source === "action" &&
        typeof event.key === "string" &&
        eventRefreshesQuery(event.key, actionName),
    );
  };
}
