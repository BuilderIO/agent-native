import {
  agentNativePath,
  appBasePath,
  appPath,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import { extensionIdFromPathname } from "@agent-native/core/client/extensions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import type {
  DispatchExtensionConfig,
  DispatchNavItem,
} from "../components/index.js";

export interface NavigationState {
  view: string;
  path?: string;
  extensionId?: string;
  extensionSlug?: string;
  dreamId?: string;
  sourceId?: string;
  query?: string;
  threadId?: string;
}

export function useNavigationState(extensions?: DispatchExtensionConfig) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const localPathname = routerPath(location.pathname);
    const state = buildDispatchNavigationState(
      localPathname,
      location.search,
      extensions,
    );

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [extensions, location.pathname, location.search]);

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
    const resolvedPath =
      cmd.path || resolvePath(cmd.view, extensions, cmd) || "/overview";
    const path =
      cmd.view === "dreams" && cmd.dreamId && !resolvedPath.includes("?")
        ? `${resolvedPath}?dreamId=${encodeURIComponent(cmd.dreamId)}`
        : resolvedPath;
    const nextPath = routerPath(path);
    if (
      isChatPath(routerPath(location.pathname)) &&
      !isChatPath(pathnameFromPath(nextPath))
    ) {
      markAgentChatHomeHandoff("dispatch");
    }
    navigate(nextPath);
    qc.setQueryData(["navigate-command"], null);
  }, [extensions, location.pathname, navCommand, navigate, qc]);
}

function pathnameFromPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

function isChatPath(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function buildDispatchNavigationState(
  pathname: string,
  search = "",
  extensions?: DispatchExtensionConfig,
): NavigationState {
  const state: NavigationState = {
    view: resolveView(pathname, extensions),
    path: appPath(pathname),
  };

  const threadId = threadIdFromPath(pathname);
  if (threadId) state.threadId = threadId;

  const extensionId = extensionIdFromPathname(pathname);
  if (extensionId) {
    state.view = "extensions";
    state.extensionId = extensionId;
    const slug = extensionSlugFromPathname(pathname);
    if (slug) state.extensionSlug = slug;
    return state;
  }

  if (state.view === "dreams") {
    const params = new URLSearchParams(search);
    const dreamId = params.get("dreamId");
    const sourceId = params.get("sourceId");
    const query = params.get("query");
    if (dreamId) state.dreamId = dreamId;
    if (sourceId) state.sourceId = sourceId;
    if (query) state.query = query;
  }

  return state;
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  let result = path;
  // Iteratively strip basename. A path that arrives doubly-prefixed
  // (e.g. "/dispatch/dispatch/overview", possibly from a stale link or a
  // prior bug) would otherwise get partially stripped here and then
  // re-prefixed by react-router's basename, restoring the bad URL.
  for (let i = 0; i < 4; i += 1) {
    if (result === basePath) return "/";
    if (!result.startsWith(`${basePath}/`)) break;
    result = result.slice(basePath.length) || "/";
  }
  return result;
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
  if (pathname === "/extensions" || pathname.startsWith("/extensions/")) {
    return "extensions";
  }
  if (pathname.startsWith("/chat")) return "chat";
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
  if (pathname.startsWith("/automations")) return "automations";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/dreams")) return "dreams";
  if (pathname.startsWith("/thread-debug")) return "thread-debug";
  if (pathname.startsWith("/team")) return "settings";
  return "overview";
}

function resolvePath(
  view?: string,
  extensions?: DispatchExtensionConfig,
  command?: Pick<NavigationState, "extensionId" | "threadId">,
): string | undefined {
  switch (view) {
    case "chat":
    case "ask":
      return command?.threadId && command.threadId.trim()
        ? `/chat/${encodeURIComponent(command.threadId.trim())}`
        : "/chat";
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
    case "automations":
    case "jobs":
      return "/automations";
    case "audit":
      return "/audit";
    case "dreams":
      return "/dreams";
    case "thread-debug":
    case "threads":
      return "/thread-debug";
    case "team":
      return "/settings#organization";
    case "extensions":
      return command?.extensionId
        ? `/extensions/${encodeURIComponent(command.extensionId)}`
        : "/extensions";
    default:
      return resolveExtensionPath(view, extensions);
  }
}

function extensionSlugFromPathname(pathname: string): string | undefined {
  const match = pathname.match(/^\/extensions\/[^/]+\/([^/?#]+)/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
