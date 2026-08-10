import {
  isAgentChatHomeHandoffActive,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client/api-path";
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
  threadDebugMode?: string;
  sourceId?: string;
  inspectSourceId?: string;
  ownerEmail?: string;
  failureStatus?: string;
  range?: string;
  query?: string;
  runId?: string;
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
      if (isAgentChatHomeHandoffActive("dispatch")) {
        markAgentChatHomeHandoff("dispatch");
      }
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

  if (state.view === "thread-debug") {
    const params = new URLSearchParams(search);
    const mode = params.get("mode");
    const sourceId = params.get("source");
    const inspectSourceId = params.get("inspectSource");
    const ownerEmail = params.get("owner");
    const status = params.get("status");
    const range = params.get("range");
    const query = params.get("query");
    const runId = params.get("runId");
    const selectedThreadId = params.get("threadId");
    if (mode) state.threadDebugMode = mode;
    if (sourceId) state.sourceId = sourceId;
    if (inspectSourceId) state.inspectSourceId = inspectSourceId;
    if (ownerEmail) state.ownerEmail = ownerEmail;
    if (status) state.failureStatus = status;
    if (range) state.range = range;
    if (query) state.query = query;
    if (runId) state.runId = runId;
    if (selectedThreadId) state.threadId = selectedThreadId;
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
  const item = extensions?.navItems?.find((candidate) => candidate.id === view);
  return item?.adminTo ?? item?.to;
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
  if (pathname === "/admin") return "admin";
  if (pathname.startsWith("/admin/")) {
    const adminView = resolveView(pathname.slice("/admin".length), extensions);
    return adminView === "overview" ? "admin" : adminView;
  }
  if (pathname.startsWith("/browser-chat")) return "browser-chat";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/apps")) return "apps";
  if (pathname.startsWith("/operations")) return "operations";
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
  if (pathname.startsWith("/transactional-email")) {
    return "transactional-email";
  }
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
    case "admin":
      return "/admin";
    case "chat":
    case "ask":
      return command?.threadId && command.threadId.trim()
        ? `/chat/${encodeURIComponent(command.threadId.trim())}`
        : "/chat";
    case "overview":
      return "/overview";
    case "apps":
      return "/apps";
    case "operations":
    case "monitoring":
    case "observability":
    case "database":
      return view === "database"
        ? "/admin/operations?view=database"
        : "/admin/operations";
    case "metrics":
    case "usage":
      return "/admin/metrics";
    case "new-app":
    case "create-app":
      return "/admin/new-app";
    case "vault":
    case "secrets":
      return "/admin/vault";
    case "integrations":
      return "/admin/integrations";
    case "workspace":
    case "resources":
      return "/admin/workspace";
    case "agents":
      return "/admin/agents";
    case "messaging":
      return "/admin/messaging";
    case "destinations":
    case "routes":
      return "/admin/destinations";
    case "identities":
      return "/admin/identities";
    case "approvals":
      return "/admin/approvals";
    case "automations":
    case "jobs":
      return "/admin/automations";
    case "transactional-email":
      return "/admin/transactional-email";
    case "audit":
      return "/admin/audit";
    case "dreams":
      return "/admin/dreams";
    case "thread-debug":
    case "threads":
      return "/admin/thread-debug";
    case "team":
      return "/settings/organization";
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
