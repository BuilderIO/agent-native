import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

function hasStatus(error: unknown, status: number): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

export function isTerminalAuthFailure(error: unknown): boolean {
  return hasStatus(error, 401) || hasStatus(error, 403);
}

function isNotFoundFailure(error: unknown): boolean {
  return hasStatus(error, 404);
}

const HOUSE_DEFAULTS: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !isTerminalAuthFailure(error) &&
        !isNotFoundFailure(error) &&
        failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
};

export function createAgentNativeQueryClient(
  overrides?: QueryClientConfig,
): QueryClient {
  if (!overrides) {
    return new QueryClient(HOUSE_DEFAULTS);
  }

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
