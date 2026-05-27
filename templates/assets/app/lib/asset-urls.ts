import { appPath } from "@agent-native/core/client";

function isAppLocalMediaPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/asset/") ||
    pathname.startsWith("/image/")
  );
}

export function assetMediaUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) {
    return isAppLocalMediaPath(url.split(/[?#]/, 1)[0] ?? "")
      ? appPath(url)
      : url;
  }
  if (typeof window === "undefined") return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (
      parsed.origin === window.location.origin &&
      isAppLocalMediaPath(parsed.pathname)
    ) {
      return appPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    }
  } catch {
    return url;
  }
  return url;
}
