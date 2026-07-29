export function isSlidesEditorRoute(pathname: string): boolean {
  return /^\/deck\/[^/]+\/?$/.test(pathname);
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
