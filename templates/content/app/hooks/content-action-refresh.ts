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
  "transcribe-media",
  "update-document",
]);

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
      filters: {
        queryKey: string[];
        type: "active";
      },
      options: { cancelRefetch: false },
    ) => unknown;
  },
  event: { source?: string; key?: string; requestSource?: string },
  browserTabId: string,
): void {
  for (const queryKey of contentActionRefreshPrefixes(event, browserTabId)) {
    void queryClient.refetchQueries(
      { queryKey, type: "active" },
      { cancelRefetch: false },
    );
  }
}
