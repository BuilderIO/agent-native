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
