export function workspaceAppRoute(appId: string): string {
  return `/apps/${encodeURIComponent(appId)}`;
}
