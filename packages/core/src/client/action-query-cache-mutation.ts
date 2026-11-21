const MUTATION_EPOCH_KEY = "agent-native.action-query-cache.mutation-epoch";

export function readMutationEpoch(): string | null | undefined {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(MUTATION_EPOCH_KEY);
  } catch {
    // coercion-ok: undefined means unreadable storage, distinct from null (no window) and a stored epoch.
    return undefined;
  }
}

export function advanceMutationEpoch(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(MUTATION_EPOCH_KEY, next);
    return window.localStorage.getItem(MUTATION_EPOCH_KEY) === next;
  } catch {
    // coercion-ok: false tells the caller the epoch was not advanced.
    return false;
  }
}

export const ACTION_CACHE_FLUSH_EVENT = "agentNative:actionCacheFlush";

export interface ActionCacheFlushDetail {
  /** This tab's mutation epoch, passed once its invalidation refetch settled. */
  settledEpoch?: string | null | undefined;
}

export function requestActionCacheFlush(settledEpoch?: string | null): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<ActionCacheFlushDetail>(ACTION_CACHE_FLUSH_EVENT, {
        detail: { settledEpoch },
      }),
    );
}
