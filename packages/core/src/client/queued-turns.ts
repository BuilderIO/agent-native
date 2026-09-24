/** A replay of one logical turn retains its first queued payload and position. */
export function normalizeQueuedTurns<T extends { turnId?: string }>(
  messages: readonly T[],
): T[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (!message.turnId) return true;
    if (seen.has(message.turnId)) return false;
    seen.add(message.turnId);
    return true;
  });
}
