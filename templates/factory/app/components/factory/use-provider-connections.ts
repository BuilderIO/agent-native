import { useActionQuery } from "@agent-native/core/client/hooks";

import type { ProviderConnection } from "./connection-rows";

/**
 * Whether each provider is connected for this person. Connecting happens in
 * another window or tab, and so does saving an unreadable key again, so while a
 * provider is still missing or unreadable the answer is read again when this
 * window is back. Every reader shares this one query, so a focus costs one
 * request at most every few seconds, and none once everything is connected.
 */
export function useProviderConnections() {
  return useActionQuery<{ providers: ProviderConnection[] }>(
    "describe-workflow-node-catalog",
    { view: "index" },
    {
      refetchOnWindowFocus: (query) =>
        (query.state.data?.providers ?? []).some(
          (entry) =>
            entry.status === "not connected" || entry.status === "unreadable",
        ),
      staleTime: 5_000,
    },
  );
}
