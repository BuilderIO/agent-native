export function isAnalyticsSessionsRoute(pathname: string): boolean {
  return pathname === "/sessions" || pathname.startsWith("/sessions/");
}

export function shouldDefaultOpenAnalyticsSidebar(pathname: string): boolean {
  return !isAnalyticsSessionsRoute(pathname);
}
