// Event types that never count as real run progress. The server's
// `last_progress_at` write (run-manager) and the browser's durable liveness
// cursor (sse-event-processor) both start from this list, so a reattached
// client cannot see progress the server never persisted. Both layers add their
// own stateful rule for action-preparation activity on top.
const NON_PROGRESS_EVENT_TYPES: ReadonlySet<string> = new Set([
  "stream_keepalive",
  "model_stream",
  "clear",
]);

export function isNonProgressEventType(type: string): boolean {
  return NON_PROGRESS_EVENT_TYPES.has(type);
}
