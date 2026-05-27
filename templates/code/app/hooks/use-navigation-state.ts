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
  extensionId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const extensionId = extensionIdFromPath(location.pathname);
    const state: NavigationState = {
      view: location.pathname.startsWith("/extensions") ? "extensions" : "code",
      path: appPath(`${location.pathname}${location.search}`),
      extensionId,
    };

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, location.search]);

  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data ? { ...data, _ts: Date.now() } : null;
    },
    refetchInterval: 2_000,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    navigate(routerPath(cmd.path || pathFromCommand(cmd)));
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}

function pathFromCommand(cmd: NavigationState): string {
  if (cmd.view === "extensions") {
    return cmd.extensionId
      ? `/extensions/${encodeURIComponent(cmd.extensionId)}`
      : "/extensions";
  }
  return "/";
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
