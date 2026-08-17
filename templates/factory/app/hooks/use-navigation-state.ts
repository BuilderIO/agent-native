import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  threadId?: string;
  factoryId?: string;
  factoryTab?: string;
  factoryAutomationId?: string;
  factoryAuditRunId?: string;
  factoryNodeId?: string;
  factoryEdgeId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => {
      const threadId = threadIdFromPath(pathname);
      return {
        view: viewForPath(pathname),
        path: appPath(pathname),
        ...(threadId ? { threadId } : {}),
        ...(pathname.startsWith("/factory") && searchParams.get("factoryId")
          ? { factoryId: searchParams.get("factoryId") ?? undefined }
          : {}),
        ...(pathname.startsWith("/factory") && searchParams.get("tab")
          ? { factoryTab: searchParams.get("tab") ?? undefined }
          : {}),
        ...(pathname.startsWith("/factory") && searchParams.get("automationId")
          ? {
              factoryAutomationId:
                searchParams.get("automationId") ?? undefined,
            }
          : {}),
        ...(pathname.startsWith("/factory") && searchParams.get("auditRunId")
          ? {
              factoryAuditRunId: searchParams.get("auditRunId") ?? undefined,
            }
          : {}),
        ...(pathname.startsWith("/factory") && searchParams.get("node")
          ? { factoryNodeId: searchParams.get("node") ?? undefined }
          : {}),
        ...(pathname.startsWith("/factory") && searchParams.get("edge")
          ? { factoryEdgeId: searchParams.get("edge") ?? undefined }
          : {}),
      };
    },
    getCommandPath: (command) =>
      routerPath(command.path || pathForCommand(command)),
  });
}

function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
    // coercion-ok: malformed route input has no valid thread id and remains outside thread selection.
  } catch {
    return null;
  }
}

function viewForPath(pathname: string): string {
  if (isChatPath(pathname)) return "chat";
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/factory")) return "factory";
  if (pathname.startsWith("/settings/agent") || pathname.startsWith("/agent")) {
    return "agent";
  }
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/team")) return "settings";
  return "chat";
}

function pathForView(view?: string): string {
  switch (view) {
    case "chat":
    case "home":
    case "ask":
      return "/chat";
    case "database":
      return "/database";
    case "extensions":
      return "/extensions";
    case "observability":
      return "/observability";
    case "factory":
      return "/factory";
    case "agents":
      return "/agents";
    case "agent":
      return "/settings/agent";
    case "settings":
      return "/settings";
    case "team":
      return "/settings/organization";
    default:
      return "/";
  }
}

function pathForCommand(command: any): string {
  const path = pathForView(command?.view);
  if (path !== "/") return path;
  const threadId =
    typeof command?.threadId === "string" ? command.threadId.trim() : "";
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
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

function isChatPath(pathname: string): boolean {
  return (
    pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/")
  );
}
