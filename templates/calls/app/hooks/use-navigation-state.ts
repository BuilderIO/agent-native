import { useEffect, useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { writeAppState } from "@agent-native/core/application-state";

/**
 * Sync the router's current state into `application_state` so the agent knows
 * which call, snippet, folder, etc. the user is looking at. The agent reads
 * `navigation` via `view-screen` and uses it to target actions at the right
 * resource without asking for IDs. Do NOT write to `navigation` from the
 * agent — only the UI owns this key.
 *
 * View values map to routes:
 *   library | call | snippet | search | trackers | upload | archive | trash
 *   settings | notifications | share | embed | invite
 */
export function useNavigationState() {
  const location = useLocation();
  const params = useParams();
  const [searchParams] = useSearchParams();

  const navState = useMemo(() => {
    const path = location.pathname;
    const view = resolveView(path);
    return {
      view,
      path,
      callId: params.callId ?? null,
      snippetId: params.snippetId ?? null,
      folderId: params.folderId ?? null,
      spaceId: params.spaceId ?? null,
      shareId: params.shareId ?? null,
      token: params.token ?? null,
      search: searchParams.get("q") ?? null,
      t:
        searchParams.get("t") != null
          ? Number(searchParams.get("t"))
          : undefined,
    };
  }, [location.pathname, params, searchParams]);

  useEffect(() => {
    writeAppState("navigation", navState).catch(() => {});
  }, [navState]);
}

function resolveView(path: string): string {
  if (path === "/" || path.startsWith("/library")) return "library";
  if (path.startsWith("/calls/")) return "call";
  if (path.startsWith("/snippets/")) return "snippet";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/trackers")) return "trackers";
  if (path.startsWith("/upload")) return "upload";
  if (path.startsWith("/archive")) return "archive";
  if (path.startsWith("/trash")) return "trash";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/notifications")) return "notifications";
  if (path.startsWith("/share-snippet/")) return "embed";
  if (path.startsWith("/share/")) return "share";
  if (path.startsWith("/embed-snippet/") || path.startsWith("/embed/"))
    return "embed";
  if (path.startsWith("/invite/")) return "invite";
  return "library";
}
