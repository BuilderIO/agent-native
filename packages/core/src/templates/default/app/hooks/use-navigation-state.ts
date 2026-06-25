import {
  appBasePath,
  appPath,
  useAgentRouteState,
} from "@agent-native/core/client";

import { TAB_ID } from "../lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  /** Optional unique-per-write token. Used by the UI to dedup the same
   * command being re-read when the fire-and-forget DELETE below loses its
   * race against the next polling refetch. */
  _writeId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search, hash }) => ({
      view: viewFromPath(pathname),
      path: appPath(`${pathname}${search}${hash}`),
    }),
    getCommandPath: (command) =>
      routerPath(command.path || pathFromView(command.view)),
  });
}

function viewFromPath(pathname: string): string {
  if (!pathname || pathname === "/") return "home";
  return pathname.replace(/^\/+/, "") || "home";
}

function pathFromView(view: string | undefined): string {
  if (!view || view === "home") return "/";
  return `/${view.replace(/^\/+/, "")}`;
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
