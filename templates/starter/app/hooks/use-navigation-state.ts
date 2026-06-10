import {
  appBasePath,
  appPath,
  useAgentRouteState,
} from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search, hash }) => ({
      view: viewForPath(pathname),
      path: appPath(pathname),
    }),
    getCommandPath: (command) =>
      routerPath(command.path || pathForView(command.view)),
  });
}

function viewForPath(pathname: string): string {
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/team")) return "team";
  return "home";
}

function pathForView(view?: string): string {
  switch (view) {
    case "extensions":
      return "/extensions";
    case "observability":
      return "/observability";
    case "team":
      return "/team";
    default:
      return "/";
  }
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
