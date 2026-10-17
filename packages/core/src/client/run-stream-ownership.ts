/**
 * Exactly one SSE reader may fold a given run/turn into UI state.
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

type RunStreamOwner = { runId: string; token: symbol };

const owners = new Map<string, RunStreamOwner>();

function runKey(threadId: string, runId: string, turnId?: string): string {
  return `${threadId} ${turnId || runId}`;
}

export function createRunStreamToken(label?: string): symbol {
  return Symbol(label ?? "run-stream-reader");
}

/**
 * Take ownership of a run's UI fold. When a logical turn id is present, all
 * background continuation run ids share one claim. Returns false when another
 * live reader already holds it — the caller must not attach, or must attach
 * read-only. Re-claiming with the same token is a no-op success so retry loops
 * are safe.
 */
export function claimRunStream(
  threadId: string,
  runId: string,
  token: symbol,
  turnId?: string,
): boolean {
  const key = runKey(threadId, runId, turnId);
  const current = owners.get(key);
  if (current && current.token !== token) return false;
  owners.set(key, { runId, token });
  return true;
}

export function preemptRunStream(
  threadId: string,
  runId: string,
  token: symbol,
  turnId?: string,
): boolean {
  const key = runKey(threadId, runId, turnId);
  const current = owners.get(key);
  owners.set(key, { runId, token });
  return current?.token !== token || current?.runId !== runId;
}

export function ownsRunStream(
  threadId: string,
  runId: string,
  token: symbol,
  turnId?: string,
): boolean {
  const owner = owners.get(runKey(threadId, runId, turnId));
  return owner?.runId === runId && owner.token === token;
}

/** Release only if still held by this token, so a late unmount cannot free a successor's claim. */
export function releaseRunStream(
  threadId: string,
  runId: string,
  token: symbol,
  turnId?: string,
): void {
  const key = runKey(threadId, runId, turnId);
  const owner = owners.get(key);
  if (owner?.runId === runId && owner.token === token) owners.delete(key);
}

export function __resetRunStreamOwnership(): void {
  owners.clear();
}
