import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  threadId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname }) => {
      const threadId = threadIdFromPath(pathname);
      return {
        view: viewForPath(pathname),
        path: appPath(pathname),
        ...(threadId ? { threadId } : {}),
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
  } catch {
    // coercion-ok: a malformed thread id in the URL selects no thread.
    return null;
  }
}

function viewForPath(pathname: string): string {
  if (pathname === "/") return "home";
  return "home";
}

function pathForView(view?: string): string {
  switch (view) {
    case "home":
      return "/";
    default:
      return "/";
  }
}

function pathForCommand(command: any): string {
  const path = pathForView(command?.view);
  if (path !== "/") return path;
  const threadId =
    typeof command?.threadId === "string" ? command.threadId.trim() : "";
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/";
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
