import { useActionQuery } from "@agent-native/core/client/hooks";

import { filterBuiltInApps, type ConnectedAppSummary } from "./other-apps";
import { appListsStatus } from "./workspace-app-layout";
import type { WorkspaceAppSummary } from "./workspace-apps";

/**
 * The app lists behind Home and All apps. Hosted apps stay empty until both
 * lists settle: a workspace that mounts its own copy of a hosted app is only
 * known from the workspace list.
 */
export function useWorkspaceAppLists({
  includeHiddenFromLaunchers = false,
}: { includeHiddenFromLaunchers?: boolean } = {}) {
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
  );
  const connectedAppsQuery = useActionQuery<ConnectedAppSummary[]>(
    "list-connected-agents",
    {},
  );
  const status = appListsStatus(appsQuery, connectedAppsQuery);
  const workspaceApps = appsQuery.data ?? [];
  const hostedApps =
    status === "ready"
      ? filterBuiltInApps(connectedAppsQuery.data ?? [], workspaceApps, {
          includeHiddenFromLaunchers,
        })
      : [];
  return { status, workspaceApps, hostedApps, appsQuery, connectedAppsQuery };
}
