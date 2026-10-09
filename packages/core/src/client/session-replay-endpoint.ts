const REPLAY_ENDPOINT_PATH = "/api/analytics/replay";
const URL_BASE = "https://analytics-endpoint.invalid";

const TRACKING_ENDPOINT_SUFFIXES = [
  "/api/analytics/track",
  "/ssr-track",
  "/build-track",
  "/config-track",
  "/track",
];

export function replayEndpointFromAnalyticsEndpoint(
  endpoint: string,
  baseUrl = URL_BASE,
): string | null {
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(endpoint);
  const isProtocolRelative = endpoint.startsWith("//");
  let url: URL;
  try {
    url = new URL(endpoint, baseUrl);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const trackingSuffix = TRACKING_ENDPOINT_SUFFIXES.find((suffix) =>
    url.pathname.endsWith(suffix),
  );
  url.pathname = trackingSuffix
    ? `${url.pathname.slice(0, -trackingSuffix.length)}${REPLAY_ENDPOINT_PATH}`
    : REPLAY_ENDPOINT_PATH;
  url.hash = "";

  if (hasScheme) return url.toString();
  if (isProtocolRelative) {
    return `//${url.host}${url.pathname}${url.search}`;
  }
  return `${url.pathname}${url.search}`;
}
