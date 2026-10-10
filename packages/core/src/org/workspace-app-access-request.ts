import {
  isWorkspaceAppAccessAllowed,
  type WorkspaceAppAccessOutcome,
} from "./workspace-app-access.js";
import { resolveWorkspaceAccessAppId } from "./workspace-app-identity.js";

export type WorkspaceAppAccessRequest = {
  path: string;
  method: string;
  email: string;
  orgId?: string | null;
};

function isWorkspaceAccessRecoveryPath(path: string, method: string): boolean {
  return (
    path === "/_agent-native/org/me" ||
    path === "/_agent-native/actions/list-workspace-apps" ||
    (method === "GET" &&
      path === "/_agent-native/actions/list-workspace-app-access") ||
    (method === "POST" &&
      path === "/_agent-native/actions/set-workspace-app-access")
  );
}

export async function checkWorkspaceAppAccessForRequest(
  request: WorkspaceAppAccessRequest,
): Promise<WorkspaceAppAccessOutcome | null> {
  const appId = resolveWorkspaceAccessAppId();
  if (!appId || isWorkspaceAccessRecoveryPath(request.path, request.method)) {
    return null;
  }

  return isWorkspaceAppAccessAllowed(appId, {
    email: request.email,
    orgId: request.orgId,
  });
}
