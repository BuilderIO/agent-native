import { getRequestContext } from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";

const ANALYTICS_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function boundedAnalyticsErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return ANALYTICS_ERROR_TYPE.test(name) ? name : "unknown_error";
}

export function trackSlidesEvent(
  name: string,
  properties: Record<string, unknown>,
  source?: Parameters<typeof track>[2],
): void {
  const authUserId = getRequestContext()?.authUserId;
  track(
    name,
    authUserId ? { ...properties, auth_user_id: authUserId } : properties,
    source,
  );
}
