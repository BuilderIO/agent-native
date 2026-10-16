import { fail } from "@agent-native/core/action";
import { hasAppSecret } from "@agent-native/core/secrets";
import type { SerializedWorkspaceConnection } from "@agent-native/core/workspace-connections";

import {
  DBT_ENVIRONMENT_CONFIG_KEY,
  DBT_SEMANTIC_LAYER_TOKEN_KEY,
  dbtConnectionReadiness,
  type DbtConnectionReadiness,
} from "./dbt-connection.js";

function dbtEnvironmentId(
  connection: SerializedWorkspaceConnection,
): string | null {
  const value = connection.config[DBT_ENVIRONMENT_CONFIG_KEY];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    fail("The saved dbt connection has an unreadable configuration.", {
      errorCode: "dbt_connection_invalid",
      statusCode: 500,
    });
  }
  return value;
}

// Provider readiness across its granted rows: any ready row makes dbt ready,
// otherwise the first row's reason is reported. A null orgId means the org
// token cannot be checked, which is an error, not a missing token.
export async function dbtProviderReadiness(
  grantedConnections: SerializedWorkspaceConnection[],
  orgId: string | null,
): Promise<DbtConnectionReadiness> {
  if (grantedConnections.length === 0) return "not_connected";
  const tokenConfigured = orgId
    ? await hasAppSecret({
        key: DBT_SEMANTIC_LAYER_TOKEN_KEY,
        scope: "org",
        scopeId: orgId,
      })
    : null;
  const readiness = grantedConnections.map((connection) =>
    dbtConnectionReadiness({
      status: connection.status,
      tokenConfigured,
      environmentId: dbtEnvironmentId(connection),
    }),
  );
  const [first] = readiness;
  return readiness.includes("ready") ? "ready" : first;
}
