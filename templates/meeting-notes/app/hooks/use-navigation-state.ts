import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type MeetingNotesView =
  | "meetings"
  | "meeting"
  | "people"
  | "companies"
  | "templates"
  | "settings";

export interface NavigationState {
  view: MeetingNotesView;
  meetingId?: string;
  folderId?: string;
  search?: string;
  path?: string;
}

interface NavigateCommand extends Partial<NavigationState> {
  path?: string;
  _ts?: number;
}

/**
 * Derive a navigation-state shape from the current URL.
 *
 * Route conventions:
 *
 *   /                              -> meetings
 *   /meetings                      -> meetings
 *   /meetings?q=...               -> meetings (with search)
 *   /meetings/folder/:folderId    -> meetings (with folderId)
 *   /m/:meetingId                 -> meeting
 *   /people                       -> people
 *   /companies                    -> companies
 *   /templates                    -> templates
 *   /settings[/*]                 -> settings
 */
function stateFromLocation(pathname: string, search: string): NavigationState {
  const params = new URLSearchParams(search);
  const searchTerm = params.get("q") || undefined;
  const p = pathname.replace(/\/+$/, "") || "/";

  // /m/:meetingId
  const meetingMatch = p.match(/^\/m\/([^/]+)$/);
  if (meetingMatch) {
    return {
      view: "meeting",
      meetingId: meetingMatch[1],
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // /meetings/folder/:folderId
  const folderMatch = p.match(/^\/meetings\/folder\/([^/]+)$/);
  if (folderMatch) {
    return {
      view: "meetings",
      folderId: folderMatch[1],
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  if (p === "/people") return { view: "people" };
  if (p === "/companies") return { view: "companies" };
  if (p === "/templates") return { view: "templates" };
  if (p.startsWith("/settings")) return { view: "settings" };
  if (p === "/meetings" || p === "/" || p === "") {
    return {
      view: "meetings",
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // Fallback
  return { view: "meetings" };
}

/**
 * Turn a navigate-command payload (from the agent) into a URL path.
 */
function pathFromCommand(cmd: NavigateCommand): string {
  if (cmd.path) return cmd.path;
  switch (cmd.view) {
    case "meeting":
      return cmd.meetingId ? `/m/${cmd.meetingId}` : "/meetings";
    case "people":
      return "/people";
    case "companies":
      return "/companies";
    case "templates":
      return "/templates";
    case "settings":
      return "/settings";
    case "meetings":
    default:
      if (cmd.folderId) return `/meetings/folder/${cmd.folderId}`;
      return "/meetings";
  }
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync current route to application state.
  useEffect(() => {
    const state = stateFromLocation(location.pathname, location.search);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch("/_agent-native/application-state/navigation", {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      }).catch(() => {});
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [location.pathname, location.search]);

  // Listen for navigate commands from the agent.
  const { data: navCommand } = useQuery<NavigateCommand | null>({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/application-state/navigate");
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
    fetch("/_agent-native/application-state/navigate", {
      method: "DELETE",
    }).catch(() => {});
    const path = pathFromCommand(navCommand);
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
