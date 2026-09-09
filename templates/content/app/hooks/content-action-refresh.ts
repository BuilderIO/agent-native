interface ActionQuery {
  queryKey: readonly unknown[];
  isActive?: () => boolean;
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

const DOCUMENT_LIFECYCLE_MUTATIONS = new Set([
  "delete-document",
  "permanently-delete-document",
  "restore-document",
  "trash-documents",
  "share-resource",
  "unshare-resource",
]);

const DOCUMENT_MUTATIONS = new Set([
  ...DOCUMENT_LIFECYCLE_MUTATIONS,
  "create-and-link-notion-page",
  "delete-document-property",
  "delete-content-database",
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
  "restore-content-database",
  "restore-document-version",
  "set-document-discoverability",
  "set-document-property",
  "set-image-alt-text",
  "sync-local-folder-source",
  "sync-manifest-local-folder-source",
  "transcribe-media",
  "update-document",
]);

const DATABASE_RESULT_MUTATIONS = new Set([
  ...DOCUMENT_LIFECYCLE_MUTATIONS,
  "add-database-item",
  "configure-document-property",
  "delete-content-database",
  "delete-document-property",
  "duplicate-database-item",
  "duplicate-database-items",
  "duplicate-document-property",
  "edit-document",
  "execute-builder-source-batch",
  "execute-builder-source-execution",
  "import-content-source",
  "migrate-content-database-rows",
  "move-database-item",
  "remove-database-items",
  "reorder-document-property",
  "restore-content-database",
  "set-document-property",
  "submit-content-database-form",
  "update-database-item",
  "update-database-items",
  "update-content-database-view",
  "update-document",
  "upsert-database-item-by-key",
]);

const DATABASE_PRESENTATION_MUTATIONS = new Set([
  "update-content-database-personal-view",
]);

const CONTENT_MUTATIONS = new Set([
  ...COMMENT_MUTATIONS,
  ...DOCUMENT_MUTATIONS,
]);

const RECENT_MUTATIONS = new Set([
  ...DOCUMENT_MUTATIONS,
  "update-content-database-view",
]);

function queryTargetsDocument(query: ActionQuery, documentId: string): boolean {
  if (query.queryKey[0] !== "action") return false;
  if (
    query.queryKey[1] !== "get-document" &&
    query.queryKey[1] !== "list-comments" &&
    query.queryKey[1] !== "list-document-properties"
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

function isDatabaseQuery(query: ActionQuery): boolean {
  if (
    query.queryKey[0] !== "action" ||
    (query.queryKey[1] !== "get-content-database" &&
      query.queryKey[1] !== "query-content-database-items")
  ) {
    return false;
  }
  return true;
}

function queryTargetsDatabase(
  query: ActionQuery,
  documentId: string | undefined,
): boolean {
  if (!isDatabaseQuery(query)) return false;
  const args = query.queryKey[2];
  return (
    (documentId !== undefined &&
      !!args &&
      typeof args === "object" &&
      "documentId" in args &&
      args.documentId === documentId) ||
    query.isActive?.() === true
  );
}

function queryTargetsActiveDatabasePresentation(query: ActionQuery): boolean {
  return (
    query.queryKey[0] === "action" &&
    query.queryKey[1] === "get-content-database-personal-view" &&
    query.isActive?.() === true
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
    const args = query.queryKey[2];
    const targetId =
      args && typeof args === "object"
        ? "id" in args
          ? args.id
          : "documentId" in args
            ? args.documentId
            : undefined
        : undefined;
    if (
      query.queryKey[0] === "action" &&
      [
        "get-content-recent",
        "list-trashed-documents",
        "list-trashed-content-databases",
        "list-content-trash",
        "get-trashed-document",
        "plan-content-trash-recovery",
      ].includes(query.queryKey[1] as string)
    ) {
      return events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          RECENT_MUTATIONS.has(event.key),
      );
    }
    if (
      typeof targetId === "string" &&
      queryTargetsDocument(query, targetId) &&
      (query.isActive ? query.isActive() : targetId === documentId)
    ) {
      // Mounted Page surfaces can belong to a collection preview rather than
      // the route. Keep inactive cached Pages out of the refresh fan-out.
      return events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          CONTENT_MUTATIONS.has(event.key),
      );
    }
    if (queryTargetsDatabase(query, documentId)) {
      return events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          DATABASE_RESULT_MUTATIONS.has(event.key),
      );
    }
    if (queryTargetsActiveDatabasePresentation(query)) {
      return events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          DATABASE_PRESENTATION_MUTATIONS.has(event.key),
      );
    }
    return false;
  };
}
