export function resolveSameOriginRoutePath(
  origin: string,
  value: unknown,
): URL | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  ) {
    return null;
  }

  if (!URL.canParse(origin)) return null;
  const base = new URL(origin);
  if (base.origin !== origin) return null;

  const routeHref = `${base.origin}${value}`;
  if (!URL.canParse(routeHref)) return null;

  const route = new URL(routeHref);
  return route.origin === base.origin ? route : null;
}

export function isSameOriginRoutePath(value: unknown): value is string {
  return (
    resolveSameOriginRoutePath("https://design-route.invalid", value) !== null
  );
}

/** The query parameter the design bridge adds to a live frame's own URL. */
export const FRAME_BRIDGE_KEY_PARAM = "agentNativeBridgeKey";

/**
 * A live route without the frame's bridge key. Only that query pair is removed
 * and the rest keeps its raw encoding, so a byte-sensitive query (a signed URL)
 * survives. DesignCanvas applies it once to every route a frame reports, so
 * editor state, pending edits and route matching never hold the key.
 */
export function routePathWithoutBridgeKey(routePath: string): string {
  const hashStart = routePath.indexOf("#");
  const beforeHash =
    hashStart === -1 ? routePath : routePath.slice(0, hashStart);
  const hash = hashStart === -1 ? "" : routePath.slice(hashStart);
  const queryStart = beforeHash.indexOf("?");
  if (queryStart === -1) return routePath;
  const pairs = beforeHash.slice(queryStart + 1).split("&");
  // The bridge reads the key with searchParams, which percent-decodes names,
  // so `%61gentNativeBridgeKey` is the key too and must be matched decoded.
  const kept = pairs.filter(
    (pair) =>
      new URLSearchParams(pair).keys().next().value !== FRAME_BRIDGE_KEY_PARAM,
  );
  if (kept.length === pairs.length) return routePath;
  const query = kept.length > 0 ? `?${kept.join("&")}` : "";
  return `${beforeHash.slice(0, queryStart)}${query}${hash}`;
}
