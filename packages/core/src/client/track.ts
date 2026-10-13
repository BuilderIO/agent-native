import {
  ANALYTICS_CLIENT_PLATFORM_HEADER,
  ANALYTICS_CLIENT_PLATFORM_PROPERTY,
} from "../shared/analytics-platform.js";
import { getAnalyticsClientPlatform } from "./analytics-platform.js";
import { getOrCreateAnalyticsSessionId } from "./analytics-session.js";
import { agentNativePath } from "./api-path.js";

export function track(
  name: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (typeof fetch !== "function") return Promise.resolve();
  if (typeof name !== "string" || !name.trim()) return Promise.resolve();

  const clientPlatform = getAnalyticsClientPlatform();
  const trackedProperties = {
    ...(properties ?? {}),
    [ANALYTICS_CLIENT_PLATFORM_PROPERTY]: clientPlatform,
  };
  let body: string;
  try {
    body = JSON.stringify({ name, properties: trackedProperties });
  } catch {
    return Promise.resolve();
  }

  const browserSessionId = getOrCreateAnalyticsSessionId();

  return fetch(agentNativePath("/_agent-native/track"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-CSRF": "1",
      [ANALYTICS_CLIENT_PLATFORM_HEADER]: clientPlatform,
      ...(browserSessionId
        ? { "X-Agent-Native-Session-Id": browserSessionId }
        : {}),
    },
    body,
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
