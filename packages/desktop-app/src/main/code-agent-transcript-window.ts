export const CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT = 200;

export function boundedCodeAgentTranscriptSnapshot<T>(
  events: readonly T[],
  limit = CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
): T[] {
  if (events.length <= limit) return [...events];
  return events.slice(-limit);
}
