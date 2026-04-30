import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  path?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const state: NavigationState = {
      view: resolveView(location.pathname),
      path: location.pathname,
    };

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Return with a timestamp to ensure uniqueness
        return { ...data, _ts: Date.now() };
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
    }).catch(() => {});
    const cmd = navCommand as NavigationState;

    // Navigate to a specific path or resolve view name to path
    const path = cmd.path || resolvePath(cmd.view) || "/overview";
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

function resolveView(pathname: string): string {
  if (pathname.startsWith("/vault")) return "vault";
  if (pathname.startsWith("/integrations")) return "integrations";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/destinations")) return "destinations";
  if (pathname.startsWith("/identities")) return "identities";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/team")) return "team";
  return "overview";
}

function resolvePath(view?: string): string | undefined {
  switch (view) {
    case "overview":
      return "/overview";
    case "vault":
    case "secrets":
      return "/vault";
    case "integrations":
      return "/integrations";
    case "workspace":
    case "resources":
      return "/workspace";
    case "agents":
      return "/agents";
    case "destinations":
    case "messaging":
    case "routes":
      return "/destinations";
    case "identities":
      return "/identities";
    case "approvals":
      return "/approvals";
    case "audit":
      return "/audit";
    case "team":
      return "/team";
    default:
      return undefined;
  }
}
