import {
  getBrowserTabId,
  useDbSync as useCoreDbSync,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";

import {
  contentDocumentIdFromPathname,
  refreshContentActionQueries,
} from "./content-action-refresh";

export function useDbSync() {
  const queryClient = useQueryClient();
  const browserTabId = getBrowserTabId();

  useCoreDbSync({
    queryClient,
    onEvent: (event) => {
      refreshContentActionQueries(
        queryClient,
        event,
        browserTabId,
        typeof window === "undefined"
          ? undefined
          : contentDocumentIdFromPathname(window.location.pathname),
      );
    },
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
