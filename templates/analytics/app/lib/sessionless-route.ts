import { isReplayFrameRequest } from "@/pages/sessions/session-replay-frame";

export function isSessionlessAnalyticsRoute(pathname: string, search: string) {
  return (
    pathname === "/status" ||
    pathname.startsWith("/status/") ||
    isReplayFrameRequest(pathname, search)
  );
}
