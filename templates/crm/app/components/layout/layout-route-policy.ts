export function isCrmSettingsRoute(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/**
 * The redesigned Settings brings its own navigation, header, and agent-panel
 * toggle, so it replaces CRM's sidebar and mobile header instead of nesting
 * inside them. A flag still loading counts as on: Settings holds the
 * redesigned shell's skeleton, nav rail included, until the answer arrives.
 */
export function isCrmFullWidthSettingsRoute(
  pathname: string,
  redesign: { status: string; enabled: boolean },
): boolean {
  if (!isCrmSettingsRoute(pathname)) return false;
  return redesign.enabled || redesign.status === "loading";
}
