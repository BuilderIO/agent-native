import { useParams } from "react-router";

import { WorkspaceAppHost } from "../../components/workspace-app-host";
import { navigateToWorkspaceApp } from "../../lib/workspace-apps";

export function navigateWorkspaceAppFromRoute(href: string): void {
  navigateToWorkspaceApp(href);
}

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

export default function WorkspaceAppRoute() {
  const { appId } = useParams();
  return (
    <WorkspaceAppHost
      appId={appId}
      navigateToTopWindow={navigateWorkspaceAppFromRoute}
    />
  );
}
