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

/** `routePath` without the query parameter `name`; anything unparseable is returned as given. */
export function routePathWithoutSearchParam(
  routePath: string,
  name: string,
): string {
  const route = resolveSameOriginRoutePath(
    "https://design-route.invalid",
    routePath,
  );
  if (!route?.searchParams.has(name)) return routePath;
  route.searchParams.delete(name);
  return `${route.pathname}${route.search}${route.hash}`;
}
