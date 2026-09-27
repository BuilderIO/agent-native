export function setUrlSearchParam(
  url: string,
  key: string,
  value: string,
): string {
  try {
    const base =
      typeof window === "undefined"
        ? "http://clips.local"
        : window.location.href;
    const parsed = new URL(url, base);
    parsed.searchParams.set(key, value);
    if (url.startsWith("/") && !url.startsWith("//")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
  } catch {
    return url;
  }
}

export function withMediaVersion(
  url: string,
  version: string | number | null | undefined,
): string {
  if (!url || version == null || version === "") return url;
  return setUrlSearchParam(url, "media", String(version));
}
