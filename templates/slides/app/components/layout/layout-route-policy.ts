export function isSlidesEditorRoute(pathname: string): boolean {
  return /^\/deck\/[^/]+\/?$/.test(pathname);
}

export function isSlidesHomeRoute(pathname: string): boolean {
  return pathname.toLowerCase().replace(/\/+$/, "") === "/home";
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
