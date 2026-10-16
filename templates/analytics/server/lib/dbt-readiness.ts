import { hasAppSecret } from "@agent-native/core/secrets";
import type { SerializedWorkspaceConnection } from "@agent-native/core/workspace-connections";

import {
  DBT_ENVIRONMENT_CONFIG_KEY,
  DBT_SEMANTIC_LAYER_TOKEN_KEY,
  dbtConnectionReadiness,
  type DbtConnectionReadiness,
} from "./dbt-connection.js";

// One corrupt row must not throw out of the shared status action, so a
// non-string saved ID is reported as an invalid environment ID instead.
function rowReadiness(
  connection: SerializedWorkspaceConnection,
  tokenConfigured: boolean | null,
): DbtConnectionReadiness {
  const value = connection.config[DBT_ENVIRONMENT_CONFIG_KEY];
  const readiness = dbtConnectionReadiness({
    status: connection.status,
    tokenConfigured,
    environmentId: typeof value === "string" ? value : null,
  });
  // Only a non-string saved value is corrupt. A blank string is missing, and the
  // readiness function reports it that way, so the two paths agree.
  if (
    readiness === "environment_missing" &&
    value !== undefined &&
    value !== null &&
    typeof value !== "string"
  ) {
    return "environment_invalid";
  }
  return readiness;
}

// A failed secret lookup is an unknown token, never a missing one, and it must
// not reject out of the shared status action.
async function tokenConfiguredFor(
  orgId: string | null,
): Promise<boolean | null> {
  if (!orgId) return null;
  try {
    return await hasAppSecret({
      key: DBT_SEMANTIC_LAYER_TOKEN_KEY,
      scope: "org",
      scopeId: orgId,
    });
  } catch (error) {
    console.warn("[analytics] dbt token lookup failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

// Provider readiness across its granted rows: any ready row makes dbt ready,
// otherwise the first row's reason is reported. A null orgId means the org
// token cannot be checked, which is an error, not a missing token.
export async function dbtProviderReadiness(
  grantedConnections: SerializedWorkspaceConnection[],
  orgId: string | null,
): Promise<DbtConnectionReadiness> {
  if (grantedConnections.length === 0) return "not_connected";
  const tokenConfigured = await tokenConfiguredFor(orgId);
  const readiness = grantedConnections.map((connection) =>
    rowReadiness(connection, tokenConfigured),
  );
  const [first] = readiness;
  if (!readiness.includes("ready")) return first;
  // With several granted connections, query-dbt-semantic-metric needs an
  // explicit connectionId, so a ready row alone is not a ready provider.
  return grantedConnections.length > 1
    ? "connection_selection_required"
    : "ready";
}
