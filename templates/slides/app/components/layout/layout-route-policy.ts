export function isSlidesEditorRoute(pathname: string): boolean {
  return /^\/deck\/[^/]+\/?$/.test(pathname);
}

export function shouldShowSlidesAppSidebar(pathname: string): boolean {
  return !isSlidesEditorRoute(pathname);
}

export function getEffectiveSlidesSidebarCollapsed({
  pathname,
  persistedCollapsed,
  editorOverride,
}: {
  pathname: string;
  persistedCollapsed: boolean;
  editorOverride?: boolean;
}): boolean {
  if (!isSlidesEditorRoute(pathname)) return persistedCollapsed;
  return editorOverride ?? true;
}

export function isSlidesSettingsRoute(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/**
 * The redesigned Settings brings its own navigation, header, and agent-panel
 * toggle, so it replaces the app's chrome instead of nesting inside it. A
 * flag still loading counts as on: Settings holds the redesigned shell's
 * skeleton, nav rail included, until the answer arrives.
 */
export function isSlidesFullWidthSettingsRoute(
  pathname: string,
  redesign: { status: string; enabled: boolean },
): boolean {
  if (!isSlidesSettingsRoute(pathname)) return false;
  return redesign.enabled || redesign.status === "loading";
}
