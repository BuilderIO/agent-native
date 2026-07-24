export const BUILDER_UTM_SOURCE = "agent-native";
export const BUILDER_UTM_MEDIUM = "product";
export const BUILDER_UTM_CAMPAIGN = "onboarding";

export function applyBuilderUtmTrackingParams(
  params: URLSearchParams,
  options: {
    medium?: string;
    campaign?: string;
    content?: string | null;
  } = {},
): void {
  params.set("utm_source", BUILDER_UTM_SOURCE);
  params.set("utm_medium", options.medium ?? BUILDER_UTM_MEDIUM);
  params.set("utm_campaign", options.campaign ?? BUILDER_UTM_CAMPAIGN);
  if (options.content) params.set("utm_content", options.content);
}

export function withBuilderUtmTrackingParams(
  url: string,
  options: {
    medium?: string;
    campaign?: string;
    content?: string | null;
  } = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (
    parsed.hostname !== "builder.io" &&
    parsed.hostname !== "www.builder.io"
  ) {
    return url;
  }
  applyBuilderUtmTrackingParams(parsed.searchParams, options);
  return parsed.toString();
}
