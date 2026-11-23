import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { focusedResource, pathFromView } from "../lib/navigation-contract";
import { TAB_ID } from "../lib/tab-id";
import { resolveRoute } from "../routes/routing/registry";

export interface NavigationState {
  view: string;
  path?: string;
  resourceKind?: "project" | "thread" | "collection" | "data-connection";
  resourceId?: string;
  resourceStatus?: "invalid-id";
  dataResourceKind?: "database" | "schema" | "table";
  dataResourceId?: string;
  dataResourceName?: string;
  dataSchemaName?: string;
  appSessionId?: string;
  releaseId?: string;
  _writeId?: string;
}

export function navigationStateForLocation({
  pathname,
  search,
  hash,
}: {
  pathname: string;
  search: string;
  hash: string;
}): NavigationState {
  const route = resolveRoute(pathname);
  const { appSessionId, version } = route.params;
  return {
    view: viewFromPath(pathname),
    path: appPath(`${pathname}${search}${hash}`),
    ...focusedResource(pathname),
    ...(route.frame === "published-app" && appSessionId && version
      ? { appSessionId, releaseId: version }
      : {}),
  };
}

export function useNavigationState() {
  const queryClient = useQueryClient();
  const { commandQueryKey, navigationState } =
    useAgentRouteState<NavigationState>({
      browserTabId: TAB_ID,
      requestSource: TAB_ID,
      getNavigationState: navigationStateForLocation,
      getCommandPath: (command) =>
        routerPath(command.path || pathFromView(command.view)),
    });
  useEffect(() => {
    if (!navigationState?.view.startsWith("thread")) return;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: commandQueryKey });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [commandQueryKey, navigationState?.view, queryClient]);
}

function viewFromPath(pathname: string): string {
  if (!pathname || pathname === "/") return "home";
  return pathname.replace(/^\/+/, "") || "home";
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
