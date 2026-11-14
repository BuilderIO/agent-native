import type { Query, QueryClient, QueryFilters } from "@tanstack/react-query";

import {
  addSurfaceVisibilityListener,
  isSurfaceHidden,
} from "../shared/surface-visibility.js";

const startedQueries = new WeakSet<object>();
const foregroundScopes = new WeakMap<object, boolean>();
interface SurfaceObserver {
  query: () => object | undefined;
  foreground: boolean;
  pause: () => void;
  updateTimers: () => void;
  shouldRefresh: () => boolean;
  explicitFocus: () => boolean;
  refresh: (foreground: boolean) => void;
}
const surfaceObservers = new Set<SurfaceObserver>();
let surfaceWasHidden = false;
let removeVisibilityListener: (() => void) | undefined;

export function claimActionQueryForeground(
  query: Pick<Query, "state" | "isActive"> | undefined,
): boolean {
  if (!query) return false;
  const initial =
    query.isActive() &&
    !startedQueries.has(query) &&
    query.state.data === undefined &&
    query.state.error === null &&
    query.state.fetchFailureCount === 0;
  startedQueries.add(query);
  return foregroundScopes.get(query) ?? initial;
}

function withQueryForeground<T>(
  query: object,
  foreground: boolean,
  run: () => T,
): T {
  foregroundScopes.set(query, foreground);
  try {
    return run();
  } finally {
    foregroundScopes.delete(query);
  }
}

export function invalidateForegroundActionQueries(
  client: QueryClient,
  filters: QueryFilters,
  foreground: boolean,
): Promise<void> {
  if (!foreground || isSurfaceHidden())
    return client.invalidateQueries(filters);
  const queries = client.getQueryCache().findAll(filters);
  for (const query of queries) foregroundScopes.set(query, true);
  try {
    return client.invalidateQueries(filters);
  } finally {
    for (const query of queries) foregroundScopes.delete(query);
  }
}

function surfaceVisibilityChanged(): void {
  const hidden = isSurfaceHidden();
  if (hidden === surfaceWasHidden) return;
  surfaceWasHidden = hidden;
  const queries = new Map<object, [SurfaceObserver, ...SurfaceObserver[]]>();
  for (const observer of surfaceObservers) {
    const query = observer.query();
    if (!query) continue;
    const group = queries.get(query);
    if (group) group.push(observer);
    else queries.set(query, [observer]);
  }
  const refreshes: SurfaceObserver[] = [];
  for (const observers of queries.values()) {
    const observer = observers[0];
    if (hidden) observer.pause();
    observer.updateTimers();
    if (hidden) continue;
    const eligible = observers.filter((current) => current.shouldRefresh());
    const refreshing =
      eligible.find(
        (current) => current.foreground && current.explicitFocus(),
      ) ??
      eligible.find((current) => current.foreground) ??
      eligible.at(0);
    if (!refreshing) continue;
    refreshes.push(refreshing);
  }
  // Explicit focus reads own the visible surface; default settings reads must
  // not consume its single return allowance just because they mounted first.
  const foregroundObserver =
    refreshes.find(
      (current) => current.foreground && current.explicitFocus(),
    ) ?? refreshes.find((current) => current.foreground);
  for (const refreshing of refreshes)
    refreshing.refresh(refreshing === foregroundObserver);
}

export function observeActionQuerySurface<TData>(
  getQuery: () => Query<TData> | undefined,
  shouldRefresh: (query: Query<TData>) => boolean,
  foreground: boolean,
  explicitFocus: () => boolean,
): () => void {
  const observer = {
    query: getQuery,
    foreground,
    pause: () => {
      const query = getQuery();
      if (
        query?.observers.some(
          (observer) => observer.options.refetchIntervalInBackground,
        )
      )
        return;
      void query?.cancel({ revert: true });
    },
    // Observer timers re-evaluate enabled against document and host visibility.
    updateTimers: () => getQuery()?.setState({}),
    shouldRefresh: () => {
      const query = getQuery();
      return query !== undefined && shouldRefresh(query);
    },
    explicitFocus,
    refresh: (foreground: boolean) => {
      const query = getQuery();
      if (!query) return;
      // Only the transition's own fetches can consume its foreground allowance.
      withQueryForeground(query, foreground, () => {
        void query.fetch(undefined, { cancelRefetch: false }).catch(() => {
          // React Query retains the error for its mounted observers.
        });
      });
    },
  };
  surfaceObservers.add(observer);
  if (!removeVisibilityListener) {
    surfaceWasHidden = isSurfaceHidden();
    const removeSurface = addSurfaceVisibilityListener(
      surfaceVisibilityChanged,
    );
    window.addEventListener("focus", surfaceVisibilityChanged);
    removeVisibilityListener = () => {
      removeSurface();
      window.removeEventListener("focus", surfaceVisibilityChanged);
    };
  }
  return () => {
    surfaceObservers.delete(observer);
    if (surfaceObservers.size === 0) {
      removeVisibilityListener?.();
      removeVisibilityListener = undefined;
    }
  };
}
