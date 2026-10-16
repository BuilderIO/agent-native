import {
  resolveWorkspaceConnectionForApp,
  type SerializedWorkspaceConnection,
} from "@agent-native/core/workspace-connections";

import { DBT_PROVIDER_ID } from "./dbt-connection.js";
import { ANALYTICS_APP_ID } from "./provider-credentials.js";

// Keeps only the rows this caller may use. A connection restricted to another
// user or group cannot serve their request, so it must not read as ready.
export async function callerAccessibleDbtConnections(
  rows: SerializedWorkspaceConnection[],
): Promise<SerializedWorkspaceConnection[]> {
  const access = await Promise.all(
    rows.map((connection) =>
      resolveWorkspaceConnectionForApp({
        appId: ANALYTICS_APP_ID,
        provider: DBT_PROVIDER_ID,
        includeDisabled: true,
        connectionId: connection.id,
      }),
    ),
  );
  return rows.filter((_, index) => access[index].available);
}
