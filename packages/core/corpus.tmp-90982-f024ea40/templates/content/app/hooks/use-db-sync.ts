import { useDbSync as useCoreDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

export function useDbSync() {
  const queryClient = useQueryClient();

  useCoreDbSync({
    queryClient,
    // refresh-notion-sync-status is a POST behind an ["action"]-keyed query
    // (useDocumentSyncStatus). Without suppression its own action-change event
    // invalidates all action queries, which refetches the POST, which emits
    // the next event — a self-sustaining refetch storm on every poll tick.
    suppressActionInvalidationFor: [
      "process-builder-body-hydration",
      "refresh-content-database-source",
      "refresh-notion-sync-status",
    ],
    queryKeys: [
      "action",
      "document-sync",
      "document-versions",
      "notion-connection",
    ],
  });
}
