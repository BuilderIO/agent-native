import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import type { QueryClientConfig } from "@tanstack/react-query";

const MAX_ANALYTICS_QUERY_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}

export function shouldRetryAnalyticsQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= MAX_ANALYTICS_QUERY_RETRIES) return false;
  if (isAbortError(error)) return false;
  const status = readErrorStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    return status === 408 || status === 429;
  }
  return true;
}

export function analyticsRetryDelay(
  attemptIndex: number,
  random: () => number = Math.random,
): number {
  const base = INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, attemptIndex);
  return Math.round(base * (0.5 + random()));
}

export function createAnalyticsQueryClient(overrides?: QueryClientConfig) {
  return createAgentNativeQueryClient({
    ...overrides,
    defaultOptions: {
      ...overrides?.defaultOptions,
      queries: {
        retry: shouldRetryAnalyticsQuery,
        retryDelay: (attemptIndex) => analyticsRetryDelay(attemptIndex),
        ...overrides?.defaultOptions?.queries,
      },
      mutations: {
        ...overrides?.defaultOptions?.mutations,
      },
    },
  });
}
