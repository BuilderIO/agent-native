import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  path?: string;
  runId?: string;
  extensionId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const runId = params.get("run") ?? undefined;
    const path = `${location.pathname}${location.search}`;
    const extensionId = extensionIdFromPath(location.pathname);
    const state: NavigationState = {
      view: location.pathname.startsWith("/extensions")
        ? "extensions"
        : "workbench",
      path: appPath(path),
      runId,
      extensionId,
    };

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, location.search]);

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
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;

    // Navigate to a specific path or resolve view name to path
    const path = routerPath(cmd.path || pathFromCommand(cmd));
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

function pathFromCommand(cmd: NavigationState): string {
  if (cmd.view === "extensions") {
    return cmd.extensionId
      ? `/extensions/${encodeURIComponent(cmd.extensionId)}`
      : "/extensions";
  }
  return cmd.runId ? `/?run=${encodeURIComponent(cmd.runId)}` : "/";
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length) || "/";
  }
  return path;
}

function extensionIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/extensions\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
