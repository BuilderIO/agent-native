/**
 * Cache-busting for stored media.
 *
 * A recording's file can be replaced while its URL stays the same — the
 * redaction burn uploads with a stable name, and the seekable-video repair
 * does too. Without a version on the URL the browser serves whatever it
 * already has, which after a burn means the *unredacted* video, playing under
 * a recording that says it is redacted.
 *
 * `mediaUpdatedAt` is the version. Every path that writes new bytes for an
 * existing recording sets it.
 */

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

/** The media URL with its version attached, or unchanged if there is none. */
export function withMediaVersion(
  url: string,
  version: string | number | null | undefined,
): string {
  if (!url || version == null || version === "") return url;
  return setUrlSearchParam(url, "media", String(version));
}
