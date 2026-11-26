import { AsyncLocalStorage } from "node:async_hooks";

import { isReadOnlyProviderPost } from "./read-only-requests.js";

const tracking = new AsyncLocalStorage<
  readonly { state: { writes: number }; requireAdmission: boolean }[]
>();

export function runWithProviderDispatchTracking<T>(
  state: { writes: number },
  work: () => Promise<T>,
  options: { requireAdmission?: boolean } = {},
): Promise<T> {
  const parents = tracking.getStore() ?? [];
  const existing = parents.find((entry) => entry.state === state);
  const entry = {
    state,
    requireAdmission:
      existing?.requireAdmission === true || options.requireAdmission === true,
  };
  return tracking.run(
    existing
      ? parents.map((parent) => (parent.state === state ? entry : parent))
      : [...parents, entry],
    work,
  );
}

export function providerDispatchRequiresAdmission(): boolean {
  return tracking.getStore()?.some((entry) => entry.requireAdmission) ?? false;
}

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
  for (const entry of tracking.getStore() ?? []) entry.state.writes++;
}
