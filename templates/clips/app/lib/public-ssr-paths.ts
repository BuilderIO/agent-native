export function isStandalonePublicPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";

  return (
    path === "/download" ||
    path === "/bug-report" ||
    path.startsWith("/bug-report/") ||
    path.startsWith("/share/") ||
    path.startsWith("/embed/") ||
    path.startsWith("/invite/")
  );
}

export function isRecordingSharePath(pathname: string): boolean {
  return /^\/share\/[^/]+\/?$/.test(pathname);
}

export function isLegacyRecordingPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/r/");
}
