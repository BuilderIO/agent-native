import {
  getBrowserTabId,
  useDbSync as useCoreDbSync,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

export function useDbSync() {
  const queryClient = useQueryClient();
  const browserTabId = getBrowserTabId();

  useCoreDbSync({
    queryClient,
    ignoreSource: browserTabId,
    actionInvalidatePredicate: contentActionInvalidatePredicate(
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
