import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { WorkspaceAppHost } from "../../components/workspace-app-host";
import {
  navigateToWorkspaceApp,
  workspaceAppInitialPathFromSplat,
} from "../../lib/workspace-apps";

export function navigateWorkspaceAppFromRoute(href: string): boolean {
  return navigateToWorkspaceApp(href);
}

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

export default function WorkspaceAppRoute() {
  const params = useParams();
  const { appId } = params;
  const location = useLocation();
  const navigate = useNavigate();
  const initialPath = workspaceAppInitialPathFromSplat(
    params["*"],
    location.search,
    location.hash,
  );
  const onChildRouteChange = useCallback(
    (path: string) => {
      const currentPath = `${location.pathname}${location.search}${location.hash}`;
      if (path === currentPath) return;
      void navigate(path, { replace: true });
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  return (
    <WorkspaceAppHost
      appId={appId}
      navigateToTopWindow={navigateWorkspaceAppFromRoute}
      initialPath={initialPath}
      onChildRouteChange={onChildRouteChange}
    />
  );
}
