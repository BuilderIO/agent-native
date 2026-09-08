function normalizePathname(pathname: string, stripEndpoint: boolean): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const withoutTrailingSlashes = normalized.replace(/\/+$/, "");
  const withoutEndpoint = stripEndpoint
    ? withoutTrailingSlashes.endsWith("/_agent-native/a2a")
      ? withoutTrailingSlashes.slice(0, -"/_agent-native/a2a".length)
      : withoutTrailingSlashes.endsWith("/a2a")
        ? withoutTrailingSlashes.slice(0, -"/a2a".length)
        : withoutTrailingSlashes
    : withoutTrailingSlashes;
  return withoutEndpoint === "" ? "/" : withoutEndpoint;
}

/** Canonical receiver identifier used by both A2A token issuers and verifiers. */
export function canonicalA2AAudience(
  rawUrl: string,
  receiverBasePath?: string,
): string {
  try {
    const url = new URL(rawUrl);
    const pathname = normalizePathname(
      receiverBasePath ?? url.pathname,
      receiverBasePath === undefined,
    );
    return pathname === "/" ? url.origin : `${url.origin}${pathname}`;
  } catch {
    return rawUrl.replace(/\/+$/, "");
  }
}
