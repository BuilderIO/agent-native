/**
 * Settings brings its own navigation, header, and agent-panel toggle, so it
 * replaces Content's sidebar and header instead of nesting inside them.
 */
export function isContentSettingsRoute(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}
