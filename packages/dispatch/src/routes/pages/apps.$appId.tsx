import { useParams } from "react-router";

import { WorkspaceAppHost } from "../../components/workspace-app-host";

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

export default function WorkspaceAppRoute() {
  const { appId } = useParams();
  return <WorkspaceAppHost appId={appId} />;
}
