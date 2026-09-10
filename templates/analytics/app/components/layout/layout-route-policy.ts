export function isAnalyticsSessionsRoute(pathname: string): boolean {
  return pathname === "/sessions" || pathname.startsWith("/sessions/");
}

export function shouldDefaultOpenAnalyticsSidebar(_pathname: string): boolean {
  return false;
}

export type AskNavigationAction = "browser" | "navigate" | "toggle";

export function resolveAskNavigationAction(
  isAskRoute: boolean,
  hasModifier: boolean,
): AskNavigationAction {
  if (hasModifier) return "browser";
  return isAskRoute ? "toggle" : "navigate";
}
