import { AsyncLocalStorage } from "node:async_hooks";

import { isReadOnlyProviderPost } from "./read-only-requests.js";

const tracking = new AsyncLocalStorage<readonly { writes: number }[]>();

/** @internal Tracks provider effects across nested framework transports. */
export function runWithProviderDispatchTracking<T>(
  state: { writes: number },
  work: () => Promise<T>,
): Promise<T> {
  const parents = tracking.getStore() ?? [];
  return tracking.run(
    parents.includes(state) ? parents : [...parents, state],
    work,
  );
}

/** @internal Call only immediately before a provider transport is invoked. */
export function noteProviderWriteDispatch(
  method: string,
  request?: { url: string; body?: unknown },
): void {
  const normalized = method.toUpperCase();
  if (
    normalized === "GET" ||
    normalized === "HEAD" ||
    normalized === "OPTIONS" ||
    normalized === "PROPFIND" ||
    normalized === "REPORT"
  )
    return;
  if (
    request &&
    isReadOnlyProviderPost({
      method: normalized,
      path: request.url,
      body: request.body,
    })
  )
    return;
  for (const state of tracking.getStore() ?? []) state.writes++;
}
