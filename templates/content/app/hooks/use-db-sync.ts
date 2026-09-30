import {
  getBrowserTabId,
  useDbSync as useCoreDbSync,
} from "@agent-native/core/client/hooks";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { isPageOpenRead } from "../lib/page-open-reads";
import { contentActionInvalidatePredicate } from "./content-action-refresh";

export function contentSyncInvalidatePredicate(
  queryClient: QueryClient,
  pathname: string,
) {
  return contentActionInvalidatePredicate(pathname, (query) =>
    isPageOpenRead(queryClient, query.queryKey),
  );
}

export function useDbSync() {
  const queryClient = useQueryClient();
  const browserTabId = getBrowserTabId();

  useCoreDbSync({
    queryClient,
    ignoreSource: browserTabId,
    actionInvalidatePredicate: contentSyncInvalidatePredicate(
      queryClient,
      typeof window === "undefined" ? "" : window.location.pathname,
    ),
    queryKeys: [
      "action",
      "document-sync",
      "document-versions",
      "notion-connection",
    ],
  });
}
