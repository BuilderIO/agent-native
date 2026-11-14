export function workspaceAppRoute(appId: string): string {
  return `/apps/${encodeURIComponent(appId)}`;
}

export function workspaceAppCatalogRoute(appId: string): string {
  return appId === "dispatch" ? "/dispatch" : workspaceAppRoute(appId);
}
