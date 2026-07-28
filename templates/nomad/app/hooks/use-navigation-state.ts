import {
  appBasePath,
  appPath,
  markAgentChatHomeHandoff,
  useAgentRouteState,
} from "@agent-native/core/client";
import { useLocation } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  threadId?: string;
  countryCode?: string;
}

export function useNavigationState() {
  const location = useLocation();
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname }) => {
      const threadId = threadIdFromPath(pathname);
      const countryCode = countryCodeFromPath(pathname);
      return {
        view: viewForPath(pathname),
        path: appPath(pathname),
        ...(threadId ? { threadId } : {}),
        ...(countryCode ? { countryCode } : {}),
      };
    },
    getCommandPath: (command) =>
      routerPath(command.path || pathForCommand(command)),
    onNavigate: (_command, path) => {
      if (
        isChatPath(location.pathname) &&
        !isChatPath(pathnameFromPath(path))
      ) {
        markAgentChatHomeHandoff("chat");
      }
    },
  });
}

function pathnameFromPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
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

function viewForPath(pathname: string): string {
  if (pathname === "/") return "cockpit";
  if (isChatPath(pathname)) return "chat";
  if (pathname.startsWith("/countries/")) return "country";
  if (pathname === "/onboarding") return "onboarding";
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/team")) return "settings";
  if (pathname.startsWith("/settings")) return "settings";
  return "cockpit";
}

function countryCodeFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/countries\/([A-Za-z]{2})/);
  return match ? match[1].toUpperCase() : null;
}

function pathForView(view?: string): string {
  // "country:PT" deep-links straight to a country page.
  if (view?.startsWith("country:")) {
    return `/countries/${view.slice("country:".length).toUpperCase()}`;
  }
  switch (view) {
    case "cockpit":
    case "map":
    case "home":
      return "/";
    case "chat":
    case "ask":
      return "/chat";
    case "onboarding":
      return "/onboarding";
    case "database":
      return "/database";
    case "extensions":
      return "/extensions";
    case "observability":
      return "/observability";
    case "settings":
      return "/settings";
    case "team":
      return "/settings#team";
    default:
      return "/";
  }
}

function pathForCommand(command: any): string {
  if (
    command?.view === "country" &&
    typeof command?.countryCode === "string" &&
    command.countryCode.trim()
  ) {
    return `/countries/${command.countryCode.trim().toUpperCase()}`;
  }
  const path = pathForView(command?.view);
  const threadId =
    typeof command?.threadId === "string" ? command.threadId.trim() : "";
  if (threadId && (path === "/chat" || command?.view === undefined)) {
    return `/chat/${encodeURIComponent(threadId)}`;
  }
  return path;
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
  return pathname === "/chat" || pathname.startsWith("/chat/");
}
