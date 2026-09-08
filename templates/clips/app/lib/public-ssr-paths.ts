/**
 * Routes that must render without the authenticated app shell.
 *
 * `/r/:recordingId` is deliberately absent: it is the private recording
 * workspace. Public playback belongs to `/share/:shareId`.
 */
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
