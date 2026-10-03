import { SLOW_ACTION_RESPONSE_MS } from "@agent-native/core/shared/analytics-events";

/**
 * A request that takes at least this long is slow. Core reports every action
 * response at or above it unsampled and marks it on the replay, so counts of
 * slow requests are exact and each one has a marker.
 */
export const SLOW_REQUEST_THRESHOLD_MS = SLOW_ACTION_RESPONSE_MS;

export function isSlowRequest(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs >= SLOW_REQUEST_THRESHOLD_MS;
}

/**
 * Whether an `action.response`'s duration is what a person waited for.
 * Background tabs throttle timers and cancelled requests never finish.
 */
export function isWaitedActionResponse(properties: {
  page_hidden?: unknown;
  outcome?: unknown;
}): boolean {
  return properties.page_hidden !== true && properties.outcome !== "cancelled";
}
