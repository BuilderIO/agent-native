import { useEffect, useMemo, useRef } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export type CallsView =
  | "library"
  | "call"
  | "snippet"
  | "search"
  | "trackers"
  | "upload"
  | "archive"
  | "trash"
  | "settings"
  | "notifications"
  | "share"
  | "embed"
  | "invite";

export interface NavigationState {
  view: CallsView;
  path: string;
  callId?: string | null;
  snippetId?: string | null;
  folderId?: string | null;
  spaceId?: string | null;
  shareId?: string | null;
  token?: string | null;
  search?: string | null;
  t?: number;
}

interface NavigateCommand extends Partial<NavigationState> {
  _ts?: number;
}

function resolveView(path: string): CallsView {
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

function pathFromCommand(cmd: NavigateCommand): string {
  if (cmd.path) return cmd.path;
  switch (cmd.view) {
    case "call":
      return cmd.callId ? `/calls/${cmd.callId}` : "/library";
    case "snippet":
      return cmd.snippetId ? `/snippets/${cmd.snippetId}` : "/library";
    case "share":
      return cmd.callId ? `/share/${cmd.callId}` : "/library";
    case "embed":
      return cmd.callId ? `/embed/${cmd.callId}` : "/library";
    case "search":
      return cmd.search
        ? `/search?q=${encodeURIComponent(cmd.search)}`
        : "/search";
    case "trackers":
      return "/trackers";
    case "upload":
      return "/upload";
    case "archive":
      return "/archive";
    case "trash":
      return "/trash";
    case "settings":
      return "/settings";
    case "notifications":
      return "/notifications";
    case "invite":
      return cmd.token ? `/invite/${cmd.token}` : "/library";
    case "library":
    default:
      if (cmd.folderId) return `/library/folder/${cmd.folderId}`;
      return "/library";
  }
}

/**
 * Sync the router's current state into `application_state` via HTTP (PUT).
 * Never imports from `@agent-native/core/application-state` on the client —
 * that's a server-only module (pulls in Node's `events`).
 */
export function useNavigationState() {
  const location = useLocation();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navState = useMemo<NavigationState>(() => {
    const path = location.pathname;
    return {
      view: resolveView(path),
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(agentNativePath("/_agent-native/application-state/navigation"), {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(navState),
      }).catch(() => {});
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [navState]);

  const { data: navCommand } = useQuery<NavigateCommand | null>({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = (await res.json()) as NavigateCommand | null;
      if (data) return { ...data, _ts: Date.now() };
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
    }).catch(() => {});
    const path = pathFromCommand(navCommand);
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
