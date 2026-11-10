interface ActionQuery {
  queryKey: readonly unknown[];
  isActive?: () => boolean;
  meta?: Record<string, unknown> | undefined;
}

interface ActionEvent {
  source?: string;
  key?: string;
  // The record the change was made to, when its action names one
  // (`changeResource`).
  resourceType?: unknown;
  resourceId?: unknown;
}

const COMMENT_MUTATIONS = new Set([
  "add-comment",
  "delete-comment",
  "sync-notion-comments",
  "update-comment",
]);

/** Changes that open, resolve, or remove a Comment thread. */
const COMMENT_COUNT_MUTATIONS = new Set([
  ...COMMENT_MUTATIONS,
  "apply-comment-ai-request",
  "undo-comment-ai-request",
]);

const DOCUMENT_MUTATIONS = new Set([
  "create-and-link-notion-page",
  "decide-resource-suggestion",
  "decide-resource-suggestion-proposal",
  "delete-document",
  "delete-document-property",
  "delete-content-database",
  "disconnect-content-database-source",
  "execute-content-trash-purge",
  "permanently-delete-document",
  "duplicate-document-property",
  "edit-document",
  "execute-builder-source-batch",
  "execute-builder-source-execution",
  "create-github-collection",
  "import-content-source",
  "link-github-folder",
  "migrate-content-database-rows",
  "move-document",
  "mutate-content-database-block",
  "patch-database-items",
  "process-builder-body-hydration",
  "pull-builder-doc",
  "pull-document",
  "pull-notion-page",
  "push-builder-doc",
  "push-notion-page",
  "refresh-content-database-source",
  "reorder-document-property",
  "resolve-local-folder-conflict",
  "resolve-notion-sync-conflict",
  "restore-document",
  "restore-content-database",
  "restore-document-version",
  "set-document-discoverability",
  "set-document-property",
  "set-image-alt-text",
  "sync-github-folder",
  "sync-local-folder-source",
  "sync-manifest-local-folder-source",
  "transcribe-media",
  "undo-content-import",
  "update-document",
]);

const DATABASE_RESULT_MUTATIONS = new Set([
  "add-database-item",
  "configure-document-property",
  "delete-content-database",
  "delete-document",
  "delete-document-property",
  "disconnect-content-database-source",
  "duplicate-database-item",
  "duplicate-database-items",
  "duplicate-document-property",
  "edit-document",
  "execute-builder-source-batch",
  "execute-builder-source-execution",
  "create-github-collection",
  "import-content-source",
  "link-github-folder",
  "migrate-content-database-rows",
  "move-database-item",
  "patch-database-items",
  "refresh-content-database-source",
  "remove-database-items",
  "reorder-document-property",
  "restore-content-database",
  "restore-document",
  "set-document-property",
  "submit-content-database-form",
  "sync-github-folder",
  "update-database-item",
  "update-database-items",
  "update-content-database-view",
  "update-document",
  "upsert-database-item-by-key",
]);

const DATABASE_PRESENTATION_MUTATIONS = new Set([
  // Deleting a property drops it from saved personal sorts and filters.
  "delete-document-property",
  "update-content-database-personal-view",
]);

const DATABASE_LIFECYCLE_MUTATIONS = new Set([
  "create-github-collection",
  "delete-content-database",
  "execute-content-trash-purge",
  "permanently-delete-document",
  "restore-content-database",
  "restore-document",
  // Files deleted in GitHub move their pages to Trash.
  "refresh-content-database-source",
  "sync-github-folder",
]);

const DOCUMENT_DISCOVERY_MUTATIONS = new Set([
  "create-document",
  "create-github-collection",
  "import-content",
  "link-github-folder",
  "refresh-content-database-source",
  "sync-github-folder",
]);

// A path entry's `hasChildren` reads the same rows and view as the Files tree,
// and any document write can add, move, or trash the pages a path counts.
const NAVIGATION_CONTEXT_MUTATIONS = new Set([
  ...DOCUMENT_MUTATIONS,
  ...DATABASE_RESULT_MUTATIONS,
  ...DATABASE_PRESENTATION_MUTATIONS,
  ...DATABASE_LIFECYCLE_MUTATIONS,
  ...DOCUMENT_DISCOVERY_MUTATIONS,
  // These add or trash a page under a parent, and no list above names them.
  "clone-creative-context-document",
  "create-content-database",
  "create-inline-content-database",
  "duplicate-page",
  "rollback-created-slash-document",
  // `hasChildren` counts only the pages the caller can see.
  "set-resource-visibility",
  "share-resource",
  "unshare-resource",
]);

/**
 * Writes from another tab or an agent that change which pages search can find,
 * or where they sit. They reload the title list even while the menu is open.
 */
const SEARCH_PLACEMENT_MUTATIONS = new Set([
  ...DOCUMENT_DISCOVERY_MUTATIONS,
  ...DATABASE_LIFECYCLE_MUTATIONS,
  "add-database-item",
  "delete-content-database",
  "delete-document",
  "duplicate-database-item",
  "duplicate-database-items",
  "duplicate-page",
  "migrate-content-database-rows",
  "move-document",
  "remove-database-items",
  // A restored version can bring back or drop a page's inline collections.
  "restore-document-version",
  "set-document-discoverability",
  // The title list holds only pages the caller can see.
  "set-resource-visibility",
  "share-resource",
  "submit-content-database-form",
  "undo-content-import",
  "unshare-resource",
  "upsert-database-item-by-key",
]);

/**
 * Those, plus writes that can rename a page. Body saves arrive as the same
 * writes, so these only mark a closed menu's titles stale: reloading every
 * title per keystroke in another tab would cost more than it shows.
 */
const SEARCH_TITLE_MUTATIONS = new Set([
  ...SEARCH_PLACEMENT_MUTATIONS,
  "patch-database-items",
  "update-database-item",
  "update-database-items",
  "update-document",
]);

const PREVIEW_DRAFT_MUTATIONS = new Set([
  "resolve-preview-document-draft",
  "update-preview-document-draft",
]);

// Changes to one page's comments, which no other page's reads carry.
const PAGE_COMMENT_MUTATIONS = new Set([
  "add-comment",
  "delete-comment",
  "update-comment",
]);

// Reads of one page's comments alone.
const PAGE_COMMENT_QUERIES = new Set([
  "list-comments",
  "list-comment-ai-requests",
]);

const DATABASE_LIFECYCLE_QUERIES = new Set([
  "list-content-databases",
  "list-documents",
  "list-trashed-content-databases",
  "list-trashed-documents",
  "list-content-trash",
]);

const CONTENT_MUTATIONS = new Set([
  ...COMMENT_MUTATIONS,
  ...DOCUMENT_MUTATIONS,
]);

export const SUGGESTION_MUTATIONS = new Set([
  "create-resource-suggestion",
  "create-resource-suggestion-proposal",
  "suggest-document-edit",
  "update-resource-suggestion",
  "decide-resource-suggestion",
  "decide-resource-suggestion-proposal",
]);

const REVIEW_MUTATIONS = new Set([
  "create-resource-suggestion",
  "create-resource-suggestion-proposal",
  "suggest-document-edit",
  "decide-resource-suggestion",
  "decide-resource-suggestion-proposal",
  "create-review-comment",
  "reply-review-comment",
  "resolve-review-thread",
  "delete-review-comment",
  "consume-review-feedback",
  "send-review-thread-to-agent",
  "set-review-status",
  "react-to-review-comment",
  "set-review-thread-unread",
  "set-review-thread-muted",
]);

const COMMENT_AI_MUTATIONS = new Set([
  "start-comment-ai-request",
  "reply-to-comment-ai-request",
  "create-comment-ai-suggestion",
  "apply-comment-ai-request",
]);

function queryTargetsDocument(query: ActionQuery, documentId: string): boolean {
  if (query.queryKey[0] !== "action") return false;
  if (
    query.queryKey[1] !== "get-document" &&
    query.queryKey[1] !== "list-comments" &&
    query.queryKey[1] !== "list-comment-ai-requests" &&
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

function queryTargetsDocumentReviewResource(
  query: ActionQuery,
  actionName: "list-resource-suggestions" | "list-review-comments",
  documentId: string,
): boolean {
  if (query.queryKey[0] !== "action" || query.queryKey[1] !== actionName)
    return false;
  const args = query.queryKey[2];
  return (
    !!args &&
    typeof args === "object" &&
    "resourceType" in args &&
    args.resourceType === "document" &&
    "resourceId" in args &&
    args.resourceId === documentId
  );
}

function eventsIncludeMutation(
  events: readonly ActionEvent[],
  mutations: ReadonlySet<string>,
): boolean {
  return events.some(
    (event) =>
      event.source === "action" &&
      typeof event.key === "string" &&
      mutations.has(event.key),
  );
}

function eventRefreshesDocumentQuery(eventKey: string, queryName: unknown) {
  if (eventKey === "start-comment-ai-request") return false;
  if (
    eventKey === "reply-to-comment-ai-request" ||
    eventKey === "create-comment-ai-suggestion"
  )
    return queryName === "list-comments";
  if (eventKey === "apply-comment-ai-request")
    return queryName === "get-document" || queryName === "list-comments";
  // Accepting a suggestion writes the Page body, or the Blocks field tab it
  // was made on.
  if (
    eventKey === "decide-resource-suggestion" ||
    eventKey === "decide-resource-suggestion-proposal"
  )
    return (
      queryName === "get-document" || queryName === "list-document-properties"
    );
  return CONTENT_MUTATIONS.has(eventKey);
}

// Whether a change named for another page can't alter what this read of
// `documentId` returns. Another page's comments never show here. Its body
// does through a rollup, which can read a related page's body or when it was
// last edited, so a body change elsewhere passes only this page's comments.
// A rename, a property change or a move can show here too, in the
// breadcrumb, a relation or a rollup, and a change that names no page may
// have touched this one: those reach it.
function eventChangesOnlyAnotherPage(
  event: ActionEvent,
  queryName: unknown,
  documentId: unknown,
): boolean {
  if (
    typeof event.key !== "string" ||
    event.resourceType !== "document" ||
    typeof event.resourceId !== "string" ||
    event.resourceId === "" ||
    typeof documentId !== "string" ||
    event.resourceId === documentId
  ) {
    return false;
  }
  if (PAGE_COMMENT_MUTATIONS.has(event.key)) return true;
  return (
    event.key === "edit-document" &&
    typeof queryName === "string" &&
    PAGE_COMMENT_QUERIES.has(queryName)
  );
}

function queryDocumentId(query: ActionQuery): unknown {
  const args = query.queryKey[2];
  return args && typeof args === "object"
    ? "id" in args
      ? args.id
      : "documentId" in args
        ? args.documentId
        : undefined
    : undefined;
}

// A read started for a page open has no observer until the page mounts, so
// the active-query rules below never reach it. Any change that could alter
// what it read spoils it, whichever page the change touched, unless the change
// is to another page's comments.
function eventSpoilsPageOpenRead(eventKey: string, queryName: unknown) {
  if (queryName === "get-preview-document-draft") {
    return PREVIEW_DRAFT_MUTATIONS.has(eventKey);
  }
  return (
    queryName === "get-document" &&
    (PREVIEW_DRAFT_MUTATIONS.has(eventKey) ||
      eventRefreshesDocumentQuery(eventKey, queryName))
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

function queryTargetsDatabase(query: ActionQuery, documentId: string): boolean {
  if (!isDatabaseQuery(query)) return false;
  const args = query.queryKey[2];
  return (
    (!!args &&
      typeof args === "object" &&
      "documentId" in args &&
      args.documentId === documentId) ||
    query.isActive?.() === true
  );
}

// The Files tree is ordered by the stored personal view but not keyed by it,
// so it reads again with that view.
function queryTargetsActiveDatabasePresentation(query: ActionQuery): boolean {
  if (query.queryKey[0] !== "action" || query.isActive?.() !== true)
    return false;
  if (query.queryKey[1] === "get-content-database-personal-view") return true;
  if (query.queryKey[1] !== "query-content-database-items") return false;
  return queryReadsFilesNavigation(query);
}

function queryReadsFilesNavigation(query: ActionQuery): boolean {
  const args = query.queryKey[2];
  return !!args && typeof args === "object" && "navigation" in args;
}

function queryIsActiveNavigationContext(query: ActionQuery): boolean {
  return (
    query.queryKey[0] === "action" &&
    query.queryKey[1] === "get-content-navigation-context" &&
    query.isActive?.() === true
  );
}

function queryTargetsActiveNavigationOrRecent(query: ActionQuery): boolean {
  if (query.queryKey[0] !== "action" || query.isActive?.() !== true)
    return false;
  if (
    query.queryKey[1] === "get-content-recent" ||
    query.queryKey[1] === "get-content-navigation-context"
  )
    return true;
  if (query.queryKey[1] !== "query-content-database-items") return false;
  return queryReadsFilesNavigation(query);
}

function isDatabaseLifecycleQuery(query: ActionQuery): boolean {
  return (
    query.queryKey[0] === "action" &&
    typeof query.queryKey[1] === "string" &&
    DATABASE_LIFECYCLE_QUERIES.has(query.queryKey[1])
  );
}

function isDocumentListQuery(query: ActionQuery): boolean {
  return (
    query.queryKey[0] === "action" && query.queryKey[1] === "list-documents"
  );
}

// The Files tree and its breadcrumb menus carry no role: they read Files pages
// by navigation, which only the Files collection answers.
function isActiveFilesDatabaseQuery(query: ActionQuery): boolean {
  return (
    isDatabaseQuery(query) &&
    query.isActive?.() === true &&
    (query.meta?.contentDatabaseSystemRole === "files" ||
      queryReadsFilesNavigation(query))
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
  isPageOpenRead: (query: ActionQuery) => boolean = () => false,
): (query: ActionQuery, events: readonly ActionEvent[]) => boolean {
  const documentId = contentDocumentIdFromPathname(pathname);
  return (query, events) => {
    if (
      query.queryKey[0] === "action" &&
      (query.queryKey[1] === "get-document" ||
        query.queryKey[1] === "get-preview-document-draft") &&
      isPageOpenRead(query) &&
      events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          eventSpoilsPageOpenRead(event.key, query.queryKey[1]) &&
          !eventChangesOnlyAnotherPage(
            event,
            query.queryKey[1],
            queryDocumentId(query),
          ),
      )
    ) {
      return true;
    }
    if (
      query.queryKey[0] === "action" &&
      (query.queryKey[1] === "list-document-titles" ||
        query.queryKey[1] === "search-documents")
    ) {
      return eventsIncludeMutation(
        events,
        query.isActive?.() === true
          ? SEARCH_PLACEMENT_MUTATIONS
          : SEARCH_TITLE_MUTATIONS,
      );
    }
    if (
      query.queryKey[0] === "action" &&
      query.queryKey[1] === "get-content-notification-prefs"
    ) {
      return events.some(
        (event) =>
          event.source === "action" &&
          event.key === "update-content-notification-prefs",
      );
    }
    if (
      queryTargetsActiveNavigationOrRecent(query) &&
      events.some(
        (event) => event.source === "action" && event.key === "update-document",
      )
    ) {
      return true;
    }
    const targetId = queryDocumentId(query);
    if (
      eventsIncludeMutation(events, DOCUMENT_DISCOVERY_MUTATIONS) &&
      (isDocumentListQuery(query) || isActiveFilesDatabaseQuery(query))
    ) {
      return true;
    }
    if (
      (isDatabaseLifecycleQuery(query) ||
        (isDatabaseQuery(query) && query.isActive?.() === true)) &&
      events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          DATABASE_LIFECYCLE_MUTATIONS.has(event.key),
      )
    ) {
      return true;
    }
    if (documentId === undefined) {
      return false;
    }
    if (
      query.queryKey[1] === "list-comment-ai-requests" &&
      typeof targetId === "string" &&
      targetId === documentId
    ) {
      return eventsIncludeMutation(events, COMMENT_AI_MUTATIONS);
    }
    if (
      queryTargetsDocumentReviewResource(
        query,
        "list-resource-suggestions",
        documentId,
      )
    ) {
      return (
        eventsIncludeMutation(events, SUGGESTION_MUTATIONS) ||
        eventsIncludeMutation(events, COMMENT_AI_MUTATIONS)
      );
    }
    if (
      queryTargetsDocumentReviewResource(
        query,
        "list-review-comments",
        documentId,
      )
    ) {
      return eventsIncludeMutation(events, REVIEW_MUTATIONS);
    }
    if (
      typeof targetId === "string" &&
      queryTargetsDocument(query, targetId) &&
      (query.isActive ? query.isActive() : targetId === documentId)
    ) {
      // A page's own read is still out when the page mounts, so this rule
      // decides whether a change spoils it as much as the page-open one does.
      return events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          eventRefreshesDocumentQuery(event.key, query.queryKey[1]) &&
          !eventChangesOnlyAnotherPage(event, query.queryKey[1], targetId),
      );
    }
    if (
      queryTargetsActiveDatabasePresentation(query) &&
      eventsIncludeMutation(events, DATABASE_PRESENTATION_MUTATIONS)
    ) {
      return true;
    }
    if (
      queryIsActiveNavigationContext(query) &&
      eventsIncludeMutation(events, NAVIGATION_CONTEXT_MUTATIONS)
    ) {
      return true;
    }
    if (queryTargetsDatabase(query, documentId)) {
      // Table rows carry their open-Comment counts, so a Comment change
      // refreshes them too. The Files tree shows no counts.
      const readsCommentCounts = !queryReadsFilesNavigation(query);
      return events.some(
        (event) =>
          event.source === "action" &&
          typeof event.key === "string" &&
          (DATABASE_RESULT_MUTATIONS.has(event.key) ||
            (readsCommentCounts && COMMENT_COUNT_MUTATIONS.has(event.key))),
      );
    }
    return false;
  };
}
