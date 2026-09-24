/**
 * Routes that must render without the authenticated app shell.
 *
 * `/r/:recordingId` stays in the client shell because legacy links need to
 * redirect anonymous viewers to the public `/share/:id` route.
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

/** Legacy recording links must bypass the app-wide session redirect first. */
export function isLegacyRecordingPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/r/");
}
