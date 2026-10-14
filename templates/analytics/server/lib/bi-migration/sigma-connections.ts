import { fail } from "@agent-native/core/action";
import {
  listWorkspaceConnectionsForApp,
  type WorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";

const ANALYTICS_APP_ID = "analytics";
const SIGMA_PROVIDER_ID = "sigma";

export interface SigmaConnectionOption {
  id: string;
  label: string;
  status: WorkspaceConnectionForApp["status"];
}

export interface SigmaConnectionSelection {
  connections: SigmaConnectionOption[];
  selected: SigmaConnectionOption | null;
  requiresSelection: boolean;
}

export async function resolveSigmaConnectionSelection(
  requestedConnectionId?: string,
): Promise<SigmaConnectionSelection> {
  const connections = await listWorkspaceConnectionsForApp({
    appId: ANALYTICS_APP_ID,
    provider: SIGMA_PROVIDER_ID,
    includeDisabled: true,
  });
  const options = connections.map((connection) => ({
    id: connection.id,
    label: connection.label || connection.accountLabel || "Sigma",
    status: connection.status,
  }));
  const usable = options.filter(
    (connection) => connection.status === "connected",
  );

  if (requestedConnectionId) {
    const selected = usable.find(
      (connection) => connection.id === requestedConnectionId,
    );
    if (!selected) {
      fail("The selected Sigma connection is unavailable to Analytics.", {
        errorCode: "sigma_connection_unavailable",
        statusCode: 403,
      });
    }
    return { connections: options, selected, requiresSelection: false };
  }

  if (usable.length === 1) {
    return {
      connections: options,
      selected: usable[0]!,
      requiresSelection: false,
    };
  }

  return {
    connections: options,
    selected: null,
    requiresSelection: usable.length > 1,
  };
}
