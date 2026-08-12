function normalizePathname(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const withoutTrailingSlashes = normalized.replace(/\/+$/, "");
  return withoutTrailingSlashes === "" ? "/" : withoutTrailingSlashes;
}

/** Canonical receiver identifier used by both A2A token issuers and verifiers. */
export function canonicalA2AAudience(
  rawUrl: string,
  receiverBasePath?: string,
): string {
  try {
    const url = new URL(rawUrl);
    const pathname = normalizePathname(receiverBasePath ?? url.pathname);
    return pathname === "/" ? url.origin : `${url.origin}${pathname}`;
  } catch {
    return rawUrl.replace(/\/+$/, "");
  }
}
