import type { ChatThreadSummary } from "@agent-native/core/client/agentkit-chat";

/** Keep genuine history plus accepted submits that have not reached storage yet. */
export function visibleChatThreads(
  threads: ChatThreadSummary[],
  observedThreadStarts: ReadonlyMap<string, number>,
): ChatThreadSummary[] {
  const knownIds = new Set(threads.map((thread) => thread.id));
  const optimistic: ChatThreadSummary[] = [...observedThreadStarts].flatMap(
    ([id, startedAt]) =>
      knownIds.has(id)
        ? []
        : [
            {
              id,
              title: "",
              preview: "",
              messageCount: 0,
              createdAt: startedAt,
              updatedAt: startedAt,
              scope: null,
            },
          ],
  );
  return [...threads, ...optimistic].filter(
    (thread) =>
      !thread.archivedAt &&
      (thread.messageCount > 0 || observedThreadStarts.has(thread.id)),
  );
}
