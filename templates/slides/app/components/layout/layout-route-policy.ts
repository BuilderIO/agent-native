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
