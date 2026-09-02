const COMMENT_MUTATIONS = new Set([
  "add-comment",
  "delete-comment",
  "update-comment",
]);

const DOCUMENT_BODY_MUTATIONS = new Set([
  "delete-document-property",
  "edit-document",
  "pull-notion-page",
  "push-notion-page",
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
    refetchQueries: (filters: {
      queryKey: string[];
      type: "active";
    }) => unknown;
  },
  event: { source?: string; key?: string; requestSource?: string },
  browserTabId: string,
): void {
  for (const queryKey of contentActionRefreshPrefixes(event, browserTabId)) {
    void queryClient.refetchQueries({ queryKey, type: "active" });
  }
}
