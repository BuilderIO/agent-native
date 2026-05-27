import { appBasePath, appPath } from "@agent-native/core/client";

function stripBasePath(pathname: string): string {
  const basePath = appBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`))
    return pathname.slice(basePath.length);
  return pathname;
}

function isAppLocalMediaPath(pathname: string): boolean {
  const unmountedPathname = stripBasePath(pathname);
  return (
    unmountedPathname === "/api" ||
    unmountedPathname.startsWith("/api/") ||
    unmountedPathname.startsWith("/asset/") ||
    unmountedPathname.startsWith("/image/") ||
    unmountedPathname.startsWith("/library-presets/")
  );
}

function mountAppLocalMediaPath(
  pathname: string,
  search = "",
  hash = "",
): string {
  return appPath(`${stripBasePath(pathname)}${search}${hash}`);
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export function assetMediaUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) {
    const parsed = new URL(url, "http://agent-native.local");
    return isAppLocalMediaPath(parsed.pathname)
      ? mountAppLocalMediaPath(parsed.pathname, parsed.search, parsed.hash)
      : url;
  }
  if (typeof window === "undefined") return url;
  try {
    const parsed = new URL(url, window.location.origin);
    const current = new URL(window.location.origin);
    const sameOrigin = parsed.origin === current.origin;
    const localDevOrigin =
      isLocalDevHost(parsed.hostname) && isLocalDevHost(current.hostname);
    if (
      (sameOrigin || localDevOrigin) &&
      isAppLocalMediaPath(parsed.pathname)
    ) {
      return mountAppLocalMediaPath(
        parsed.pathname,
        parsed.search,
        parsed.hash,
      );
    }
  } catch {
    return url;
  }
  return url;
}
