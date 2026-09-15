/**
 * The Labs settings tab canonicalizes a bare `/settings#lab-<key>` deep link
 * into a `/settings/labs/lab-<key>` path segment. Lab keys are always
 * dotted (e.g. `clips.meetings`), and any static-asset middleware that
 * treats a dotted last path segment as a file request 404s on refresh.
 * Linking straight to the already-canonical `/settings/labs` path (with the
 * lab id kept only in the hash, which browsers never send to the server)
 * keeps the URL refreshable.
 */
export function getMeetingsSidebarHref(
  meetingsLabEnabled: boolean,
  meetingsLabKey: string,
): string {
  return meetingsLabEnabled
    ? "/meetings"
    : `/settings/labs#lab-${meetingsLabKey}`;
}
