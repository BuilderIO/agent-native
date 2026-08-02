/**
 * A stream that has emitted nothing is indistinguishable from a hung handler.
 *
 * On Workers that is not a metaphor: workerd's hang detector cancels a request
 * holding an unresolved response with no I/O in flight, and in `wrangler dev`
 * that cancellation surfaces to the dev proxy as "Network connection lost" and
 * takes the whole server down — killing any background agent run in the same
 * process. A quiet change stream is the normal case for these endpoints, so
 * they must say so on the wire rather than going silent. Keep the interval well
 * under any intermediary's idle timeout too; proxies drop silent connections
 * for the same reason.
 */
const KEEP_ALIVE_INTERVAL_MS = 15_000;

/**
 * Named so it reaches only an explicit `addEventListener`, never the client's
 * `onmessage` — same reason the realtime control frames are named events. A
 * bare `data:` frame would be parsed as a change event and corrupt the sync.
 */
export const SSE_KEEP_ALIVE_EVENT = "keep-alive";

interface KeepAliveStream {
  push(message: { event: string; data: string }): unknown;
}

/**
 * Emit a keep-alive immediately and on an interval. Returns the stopper; call
 * it from the stream's `onClosed`.
 */
export function startSseKeepAlive(stream: KeepAliveStream): () => void {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    try {
      stream.push({
        event: SSE_KEEP_ALIVE_EVENT,
        data: String(Date.now()),
      });
    } catch {
      // Connection already gone — the caller's onClosed clears the timer.
    }
  };
  // Immediately, so the very first idle window is already covered.
  tick();
  const timer = setInterval(tick, KEEP_ALIVE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
