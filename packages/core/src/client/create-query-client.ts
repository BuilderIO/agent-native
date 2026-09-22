/**
 * Shared QueryClient factory for agent-native apps.
 *
 * Exports a single `createAgentNativeQueryClient(overrides?)` so every
 * template root uses the same house defaults rather than a bare
 * `new QueryClient()` (which ships with staleTime=0 and
 * refetchOnWindowFocus=true, causing unnecessary network requests because the
 * useDbSync layer already pushes real-time invalidations on actual changes).
 *
 * House defaults:
 * - staleTime 30s  — data is considered fresh for 30 s; useDbSync invalidates
 *   on real changes so this only affects the window between sync events.
 * - retry          — never retry 401/403/404; allow one retry for transient errors.
 * - refetchOnWindowFocus false — useDbSync already runs its own focus poll
 *   (use-db-sync.ts) so unconditional refetch on focus would double-fetch.
 *
 * Callers may pass deep overrides for intentional deviations (e.g. a template
 * that uses a domain-specific staleTime for a particular query category).
 */
import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

function hasStatus(error: unknown, status: number): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

/**
 * True for HTTP 401 / 403 — an expired or missing session that a retry
 * cannot fix. Exported so useActionQuery's refetchInterval guard and
 * use-db-sync.ts's sync-invalidation skip reuse this one predicate instead of
 * each keeping a private copy.
 */
export function isTerminalAuthFailure(error: unknown): boolean {
  return hasStatus(error, 401) || hasStatus(error, 403);
}

/** True for HTTP 404 — a resource that will not appear on retry. */
function isNotFoundFailure(error: unknown): boolean {
  return hasStatus(error, 404);
}

/** House defaults merged into every template QueryClient. */
const HOUSE_DEFAULTS: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // 30 s matches the mail template's battle-tested value; useDbSync
      // invalidates caches on real DB changes so this gap is only relevant
      // for the window between two sync events.
      staleTime: 30_000,
      // Never retry auth failures or a 404 — none succeed on retry. Allow
      // one retry for transient network/server errors.
      retry: (failureCount, error) =>
        !isTerminalAuthFailure(error) &&
        !isNotFoundFailure(error) &&
        failureCount < 1,
      // The useDbSync hook already runs a focus-aware event poll, so
      // React Query's own refetchOnWindowFocus would cause duplicate
      // refetches on every window-focus event.
      refetchOnWindowFocus: false,
    },
  },
};

/**
 * Creates a QueryClient pre-configured with agent-native house defaults.
 *
 * Pass `overrides` for intentional template-specific deviations — only what
 * actually differs from the house defaults should be specified.
 */
export function createAgentNativeQueryClient(
  overrides?: QueryClientConfig,
): QueryClient {
  if (!overrides) {
    return new QueryClient(HOUSE_DEFAULTS);
  }

  // Deep-merge only the defaultOptions.queries layer so callers can override
  // individual fields without having to replicate the full config.
  const mergedQueries = {
    ...HOUSE_DEFAULTS.defaultOptions?.queries,
    ...overrides.defaultOptions?.queries,
  };
  const mergedMutations = {
    ...HOUSE_DEFAULTS.defaultOptions?.mutations,
    ...overrides.defaultOptions?.mutations,
  };

  return new QueryClient({
    ...HOUSE_DEFAULTS,
    ...overrides,
    defaultOptions: {
      ...HOUSE_DEFAULTS.defaultOptions,
      ...overrides.defaultOptions,
      queries: mergedQueries,
      mutations: mergedMutations,
    },
  });
}
