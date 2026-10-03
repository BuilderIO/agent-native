import { SLOW_ACTION_RESPONSE_MS } from "@agent-native/core/shared/analytics-events";

export { isWaitedActionResponse } from "@agent-native/core/shared/analytics-events";

/**
 * A request that takes at least this long is slow. Core reports every action
 * response at or above it unsampled and marks each one someone waited for on
 * the replay, so counts of slow requests are exact and each one has a marker.
 */
export const SLOW_REQUEST_THRESHOLD_MS = SLOW_ACTION_RESPONSE_MS;

export function isSlowRequest(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= SLOW_REQUEST_THRESHOLD_MS;
}
