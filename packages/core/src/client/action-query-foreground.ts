import type {
  InvalidateOptions,
  InvalidateQueryFilters,
  Query,
  QueryClient,
} from "@tanstack/react-query";

import {
  addSurfaceVisibilityListener,
  isSurfaceHidden,
} from "../shared/surface-visibility.js";

const startedQueries = new WeakSet<object>();
// A foreground read that failed is still the person's read: its retries stay
// foreground until its fetch answers, even when a previous result was cached.
const unansweredForeground = new WeakMap<object, number>();
// An open tab whose read keeps failing must not stream foreground provider
// calls on every retry and refetch tick: past this many failures it is background.
const MAX_FOREGROUND_RETRIES = 3;
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
let windowBlurred = false;
let removeVisibilityListener: (() => void) | undefined;

export function claimActionQueryForeground(
  query: Pick<Query, "state" | "isActive"> | undefined,
): boolean {
  if (!query) return false;
  // Restored and projected cache rows have update counts, but no request in
  // this document. Only a fetch claimed here can spend its first-read allowance.
  const initial =
    query.isActive() &&
    !startedQueries.has(query) &&
    query.state.error === null &&
    query.state.fetchFailureCount === 0;
  startedQueries.add(query);
  const scoped = foregroundScopes.get(query);
  const retry =
    unansweredForeground.get(query) === query.state.dataUpdateCount &&
    query.isActive() &&
    query.state.fetchFailureCount > 0 &&
    query.state.fetchFailureCount <= MAX_FOREGROUND_RETRIES;
  const foreground = scoped ?? (initial || retry);
  if (foreground) unansweredForeground.set(query, query.state.dataUpdateCount);
  else unansweredForeground.delete(query);
  return foreground;
}

export function finishActionQueryOpening(
  query: Pick<Query, "state" | "isActive"> | undefined,
): void {
  // A fresh cache can answer the opening without a request. Its first later
  // timer or reconnect fetch must not inherit the opening's allowance.
  if (
    query?.isActive() &&
    query.state.fetchStatus === "idle" &&
    query.state.data !== undefined
  )
    startedQueries.add(query);
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

export function refetchActionQueryInForeground<T>(
  query: object | undefined,
  run: () => T,
): T {
  if (!query || isSurfaceHidden()) return run();
  return withQueryForeground(query, true, run);
}

export function invalidateForegroundActionQueries(
  client: QueryClient,
  filters: InvalidateQueryFilters,
  foreground: boolean,
  options?: InvalidateOptions,
): Promise<void> {
  // Hydration supplies data before a hook supplies its reader. Keep those rows
  // stale until the reader can fetch them, without creating a missing-queryFn error.
  const dataOnly = new Set(
    client
      .getQueryCache()
      .findAll(filters)
      .filter(
        (query) =>
          query.getObserversCount() === 0 &&
          query.state.data !== undefined &&
          query.options.queryFn === undefined,
      ),
  );
  for (const query of dataOnly) query.invalidate();
  const readableFilters: InvalidateQueryFilters = dataOnly.size
    ? {
        ...filters,
        predicate: (query) =>
          !dataOnly.has(query) &&
          (!filters.predicate || filters.predicate(query)),
      }
    : filters;
  if (!foreground || isSurfaceHidden())
    return client.invalidateQueries(readableFilters, options);
  const queries = client.getQueryCache().findAll(readableFilters);
  for (const query of queries) foregroundScopes.set(query, true);
  try {
    return client.invalidateQueries(readableFilters, options);
  } finally {
    for (const query of queries) foregroundScopes.delete(query);
  }
}

function surfaceVisibilityChanged(): void {
  refreshForSurface(false);
}

function surfaceBlurred(): void {
  windowBlurred = true;
}

// Returning to a desktop window whose tab never stopped being visible changes
// no visibility, but it is still a return to the surface and refreshes stale
// reads, as React Query's own window-focus refetch would. Only a focus after a
// blur counts, so the focus that accompanies a visibility return is not a
// second refresh.
function surfaceFocused(): void {
  refreshForSurface(windowBlurred);
}

function refreshForSurface(returnedFocus: boolean): void {
  const hidden = isSurfaceHidden();
  if (hidden === surfaceWasHidden && !(returnedFocus && !hidden)) return;
  surfaceWasHidden = hidden;
  if (!hidden) windowBlurred = false;
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
    windowBlurred = false;
    const removeSurface = addSurfaceVisibilityListener(
      surfaceVisibilityChanged,
    );
    window.addEventListener("focus", surfaceFocused);
    window.addEventListener("blur", surfaceBlurred);
    removeVisibilityListener = () => {
      removeSurface();
      window.removeEventListener("focus", surfaceFocused);
      window.removeEventListener("blur", surfaceBlurred);
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
