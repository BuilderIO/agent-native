import {
  appBasePath,
  appPathFromLocalRoute,
} from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { paths } from "@/components/shell/paths";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view?: string;
  path?: string;
  publicPath?: string;
  formId?: string;
  workspaceId?: string;
  tab?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname }) => navigationStateForPath(pathname),
    getCommandPath: commandPathForNavigation,
  });
}

export function commandPathForNavigation(command: NavigationState): string {
  const fallbackPath = pathForCommand(command);
  const path = typeof command.path === "string" ? command.path : "";
  if (!path) return fallbackPath;

  const basePath = appBasePath();
  if (!basePath) return path;

  const suffixIndex = path.search(/[?#]/);
  const pathname = suffixIndex === -1 ? path : path.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : path.slice(suffixIndex);
  const publicPath =
    typeof command.publicPath === "string" ? command.publicPath : "";
  const publicPathSuffixIndex = publicPath.search(/[?#]/);
  const declaredPublicPath =
    publicPathSuffixIndex === -1
      ? publicPath
      : publicPath.slice(0, publicPathSuffixIndex);
  const publicViewPath = appPathFromLocalRoute(pathForView(command.view));
  if (
    matchesPathPrefix(pathname, basePath) &&
    (matchesPathPrefix(pathname, publicViewPath) ||
      (declaredPublicPath && declaredPublicPath === pathname))
  ) {
    return `${pathname.slice(basePath.length) || "/"}${suffix}`;
  }
  return path;
}

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function navigationStateForPath(pathname: string): NavigationState {
  const state: NavigationState = {
    view: viewForPath(pathname),
    path: pathname,
    publicPath: appPathFromLocalRoute(pathname),
  };
  const form = pathname.match(/^\/forms\/([^/]+)(?:\/([^/]+))?/);
  const formId = form?.[1];
  if (formId) {
    state.formId = decodeURIComponent(formId);
    state.tab = form[2] === "edit" ? "edit" : (form[2] ?? "insights");
  }
  const workspaceId = pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
  if (workspaceId) state.workspaceId = decodeURIComponent(workspaceId);
  return state;
}

function viewForPath(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/workspaces/")) return "workspace";
  if (pathname.startsWith("/forms/")) {
    return pathname.endsWith("/edit") ? "editor" : "form";
  }
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/settings/agent") || pathname.startsWith("/agent")) {
    return "agent";
  }
  if (pathname.startsWith("/settings") || pathname.startsWith("/team")) {
    return "settings";
  }
  return "home";
}

function pathForView(view?: string): string {
  switch (view ?? "") {
    case "database":
      return "/database";
    case "extensions":
      return "/extensions";
    case "observability":
      return "/observability";
    case "agent":
      return "/settings/agent";
    case "settings":
      return "/settings";
    case "team":
      return "/settings/organization";
    default:
      return paths.home;
  }
}

const FORM_TABS = new Set(["submissions", "share", "settings"]);

export function pathForCommand(command: NavigationState): string {
  if (command.view === "workspace" && command.workspaceId)
    return paths.workspace(command.workspaceId);
  if (
    command.formId &&
    (command.view === "form" || command.view === "editor")
  ) {
    if (command.view === "editor" || command.tab === "edit")
      return paths.edit(command.formId);
    return command.tab && FORM_TABS.has(command.tab)
      ? paths.formTab(command.formId, command.tab as "submissions")
      : paths.form(command.formId);
  }
  return pathForView(command.view);
}
