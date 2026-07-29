export function isAnalyticsSessionsRoute(pathname: string): boolean {
  return pathname === "/sessions" || pathname.startsWith("/sessions/");
}

export function shouldDefaultOpenAnalyticsSidebar(_pathname: string): boolean {
  return false;
}
