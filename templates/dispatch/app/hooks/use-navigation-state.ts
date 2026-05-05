import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client";
import type {
  DispatchExtensionConfig,
  DispatchNavItem,
} from "@agent-native/dispatch/components";

export interface NavigationState {
  view: string;
  path?: string;
}

export function useNavigationState(extensions?: DispatchExtensionConfig) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const state: NavigationState = {
      view: resolveView(location.pathname, extensions),
      path: appPath(location.pathname),
    };

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [extensions, location.pathname]);

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
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;

    const path = routerPath(
      cmd.path || resolvePath(cmd.view, extensions) || "/overview",
    );
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [extensions, navCommand, navigate, qc]);
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

function extensionItemMatchesPath(
  item: DispatchNavItem,
  pathname: string,
): boolean {
  if (item.match) {
    try {
      if (item.match(pathname)) return true;
    } catch {
      return false;
    }
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function resolveExtensionView(
  pathname: string,
  extensions?: DispatchExtensionConfig,
): string | undefined {
  return extensions?.navItems?.find((item) =>
    extensionItemMatchesPath(item, pathname),
  )?.id;
}

function resolveExtensionPath(
  view: string | undefined,
  extensions?: DispatchExtensionConfig,
): string | undefined {
  if (!view) return undefined;
  return extensions?.navItems?.find((item) => item.id === view)?.to;
}

function resolveView(
  pathname: string,
  extensions?: DispatchExtensionConfig,
): string {
  const extensionView = resolveExtensionView(pathname, extensions);
  if (extensionView) return extensionView;
  if (pathname.startsWith("/apps")) return "apps";
  if (pathname.startsWith("/metrics")) return "metrics";
  if (pathname.startsWith("/new-app")) return "new-app";
  if (pathname.startsWith("/vault")) return "vault";
  if (pathname.startsWith("/integrations")) return "integrations";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/messaging")) return "messaging";
  if (pathname.startsWith("/destinations")) return "destinations";
  if (pathname.startsWith("/identities")) return "identities";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/team")) return "team";
  return "overview";
}

function resolvePath(
  view?: string,
  extensions?: DispatchExtensionConfig,
): string | undefined {
  switch (view) {
    case "overview":
      return "/overview";
    case "apps":
      return "/apps";
    case "metrics":
    case "usage":
      return "/metrics";
    case "new-app":
    case "create-app":
      return "/new-app";
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
    case "messaging":
      return "/messaging";
    case "destinations":
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
      return resolveExtensionPath(view, extensions);
  }
}
