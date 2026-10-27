import { isTerminalActionError } from "@agent-native/core/client/hooks";

const RUN_REFRESH_RETRY_MS = 30_000;

/**
 * How long to wait before refreshing a stale pending run again after a failed
 * attempt; `null` means never. A run the server reports as gone (404 /
 * `not_found`) never comes back, so retrying it only repeats the refusal.
 */
export function runRefreshRetryDelayMs(error: unknown): number | null {
  return isTerminalActionError(error) ? null : RUN_REFRESH_RETRY_MS;
}
