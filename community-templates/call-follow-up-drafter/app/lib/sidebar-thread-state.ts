import type { ChatThreadSummary } from "@agent-native/toolkit/app/chat/agentkit-chat/rail";

export function optimisticStartedThreads(
  threads: readonly ChatThreadSummary[],
  observedThreadStarts: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const knownIds = new Set(threads.map((thread) => thread.id));
  return new Map([...observedThreadStarts].filter(([id]) => !knownIds.has(id)));
}
