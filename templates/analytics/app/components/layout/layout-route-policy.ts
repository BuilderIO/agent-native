export function isAnalyticsSessionsRoute(pathname: string): boolean {
  return pathname === "/sessions" || pathname.startsWith("/sessions/");
}

/** Pages under /sessions/ that are not one replay, matched before its id. */
const SESSIONS_PAGES = new Set(["/sessions/events", "/sessions/performance"]);

/** One replay's page, which brings its own header. */
export function isSessionReplayRoute(pathname: string): boolean {
  return (
    /^\/sessions\/[^/]+/.test(pathname) &&
    !SESSIONS_PAGES.has(pathname.replace(/\/+$/, ""))
  );
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
