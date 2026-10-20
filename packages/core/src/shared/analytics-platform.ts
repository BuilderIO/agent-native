export const ANALYTICS_CLIENT_PLATFORM_HEADER =
  "X-Agent-Native-Client-Platform";
export const ANALYTICS_CLIENT_PLATFORM_PROPERTY = "client_platform";
export const ANALYTICS_CLIENT_PLATFORM_BODY_FIELD =
  "__agentNativeClientPlatform";

export const ANALYTICS_CLIENT_PLATFORMS = [
  "web",
  "electron",
  "mobile",
] as const;

export type AnalyticsClientPlatform =
  (typeof ANALYTICS_CLIENT_PLATFORMS)[number];

export function normalizeAnalyticsClientPlatform(
  value: unknown,
): AnalyticsClientPlatform | undefined {
  return typeof value === "string" &&
    (ANALYTICS_CLIENT_PLATFORMS as readonly string[]).includes(value)
    ? (value as AnalyticsClientPlatform)
    : undefined;
}
