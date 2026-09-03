/**
 * Exactly one SSE reader may fold a given run into UI state.
 *
 * Two readers attach to the same run routinely: the chat adapter's own stream,
 * and AssistantChat's reconnect reader for runs with no live adapter stream
 * (page reload, tab restore). When both are attached they build two independent
 * accumulators from the same events, and the UI renders both — duplicate tool
 * cards (one spinning, one static) and the same assistant text streaming twice.
 *
 * The previous guard read a React ref (`isRuntimeRunningRef`) at attach time and
 * re-checked it from a 1s poll. That is a race, not a lock: the ref lags a
 * render behind, the poll is skipped while the tab is hidden, and the refs were
 * per-component-instance while MultiTabAssistantChat mounts several instances
 * against one run. Ownership therefore lives here — module scope, one registry
 * per browser tab, claimed and checked synchronously.
 *
 * Claims are advisory in one direction only: a reader that does not hold the
 * claim must not mutate UI state. It may still drain its socket to completion.
 */

const owners = new Map<string, symbol>();

function runKey(threadId: string, runId: string): string {
  return `${threadId} ${runId}`;
}

/** Mint a token identifying one reader. Not shared between readers. */
export function createRunStreamToken(label?: string): symbol {
  return Symbol(label ?? "run-stream-reader");
}

/**
 * Take ownership of a run's UI fold. Returns false when another live reader
 * already holds it — the caller must not attach, or must attach read-only.
 * Re-claiming with the same token is a no-op success so retry loops are safe.
 */
export function claimRunStream(
  threadId: string,
  runId: string,
  token: symbol,
): boolean {
  const key = runKey(threadId, runId);
  const current = owners.get(key);
  if (current && current !== token) return false;
  owners.set(key, token);
  return true;
}

/**
 * Take ownership even if another reader holds it, and return whether the claim
 * changed hands. The adapter's own stream outranks the reconnect fallback: when
 * the user sends a message the adapter legitimately becomes the owner, and the
 * displaced reader learns it lost via `ownsRunStream`.
 */
export function preemptRunStream(
  threadId: string,
  runId: string,
  token: symbol,
): boolean {
  const key = runKey(threadId, runId);
  const current = owners.get(key);
  owners.set(key, token);
  return current !== token;
}

export function ownsRunStream(
  threadId: string,
  runId: string,
  token: symbol,
): boolean {
  return owners.get(runKey(threadId, runId)) === token;
}

/** Release only if still held by this token, so a late unmount cannot free a successor's claim. */
export function releaseRunStream(
  threadId: string,
  runId: string,
  token: symbol,
): void {
  const key = runKey(threadId, runId);
  if (owners.get(key) === token) owners.delete(key);
}

/** Test seam. */
export function __resetRunStreamOwnership(): void {
  owners.clear();
}
