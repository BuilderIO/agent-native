import {
  getBrowserTabId,
  useDbSync as useCoreDbSync,
} from "@agent-native/core/client/hooks";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";

import { isPageOpenRead } from "../lib/page-open-reads";
import {
  contentActionInvalidatePredicate,
  contentDocumentIdFromPathname,
} from "./content-action-refresh";

export function contentSyncInvalidatePredicate(
  queryClient: QueryClient,
  pathname: string,
) {
  return contentActionInvalidatePredicate(pathname, (query) =>
    isPageOpenRead(queryClient, query.queryKey),
  );
}

export function isPrivateDocumentEditorPath(pathname: string): boolean {
  return contentDocumentIdFromPathname(pathname) !== undefined;
}

export function useDbSync() {
  const queryClient = useQueryClient();
  const browserTabId = getBrowserTabId();
  const location = useLocation();

  useCoreDbSync({
    queryClient,
    ignoreSource: browserTabId,
    actionInvalidatePredicate: contentSyncInvalidatePredicate(
      queryClient,
      location.pathname,
    ),
    queryKeys: [
      "action",
      "document-sync",
      "document-versions",
      "notion-connection",
    ],
    realtime: isPrivateDocumentEditorPath(location.pathname)
      ? { reason: "collaborators can edit and comment on this open document" }
      : undefined,
  });
}
