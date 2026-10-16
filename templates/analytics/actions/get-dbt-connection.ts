import { defineAction, fail } from "@agent-native/core/action";
import { hasAppSecret } from "@agent-native/core/secrets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { listWorkspaceConnectionsForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { resolveOrgRole } from "../server/lib/db-admin-connections.js";
import { callerAccessibleDbtConnections } from "../server/lib/dbt-caller-connections.js";
import {
  DBT_BASE_URL_CONFIG_KEY,
  DBT_CONNECTION_READINESS,
  DBT_ENVIRONMENT_CONFIG_KEY,
  DBT_PROVIDER_ID,
  DBT_SEMANTIC_LAYER_TOKEN_KEY,
  dbtConnectionReadiness,
} from "../server/lib/dbt-connection.js";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials.js";

const CONNECTION_STATUS = [
  "connected",
  "checking",
  "needs_reauth",
  "error",
  "disabled",
] as const;

// A missing key means "not set yet"; a present non-string means the stored
// row is corrupt and must not look like an unconfigured connection.
function configString(
  connection: { config: Record<string, unknown> } | null,
  key: string,
): string | null {
  const value = connection?.config[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    fail("The saved dbt connection has an unreadable configuration.", {
      errorCode: "dbt_connection_invalid",
      statusCode: 500,
    });
  }
  return value;
}

export default defineAction({
  description:
    "Read the organization's dbt Cloud Semantic Layer connection for Analytics: status, environment ID, GraphQL URL, and whether the token is saved. `readiness` names the first missing step: ready, not_connected, token_missing, environment_missing, needs_reauth, or error. `connected` is true only when ready. With several dbt connections, top-level connection fields and readiness are null: pick one `connections[].id` for query-dbt-semantic-metric. Never returns the token value. Read-only.",
  schema: z.object({}),
  outputSchema: z.object({
    connected: z.boolean(),
    readiness: z.enum(DBT_CONNECTION_READINESS).nullable(),
    connectionId: z.string().nullable(),
    status: z.enum(CONNECTION_STATUS).nullable(),
    environmentId: z.string().nullable(),
    semanticLayerBaseUrl: z.string().nullable(),
    tokenConfigured: z.boolean(),
    canManage: z.boolean(),
    connections: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(CONNECTION_STATUS),
        readiness: z.enum(DBT_CONNECTION_READINESS),
      }),
    ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = getRequestUserEmail() || ctx?.userEmail;
    if (!email) {
      fail("Sign in to read the dbt connection.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || ctx?.orgId;
    if (!orgId) {
      fail("An active organization is required to read the dbt connection.", {
        errorCode: "organization_required",
        statusCode: 403,
      });
    }

    const [connections, tokenConfigured, role] = await Promise.all([
      listWorkspaceConnectionsForApp({
        appId: ANALYTICS_APP_ID,
        provider: DBT_PROVIDER_ID,
        includeDisabled: true,
      }),
      hasAppSecret({
        key: DBT_SEMANTIC_LAYER_TOKEN_KEY,
        scope: "org",
        scopeId: orgId,
      }),
      resolveOrgRole(email, orgId),
    ]);
    const callerConnections = await callerAccessibleDbtConnections(connections);
    const listed = callerConnections.map((connection) => {
      const environmentId = configString(
        connection,
        DBT_ENVIRONMENT_CONFIG_KEY,
      );
      return {
        connection,
        environmentId,
        readiness: dbtConnectionReadiness({
          status: connection.status,
          tokenConfigured,
          environmentId,
        }),
      };
    });
    // With several connections the caller must pick one by id, so the
    // top-level fields stay null rather than describing an arbitrary row.
    const selected = listed.length === 1 ? listed[0] : null;

    return {
      connected: selected?.readiness === "ready",
      readiness:
        listed.length === 0 ? "not_connected" : (selected?.readiness ?? null),
      connectionId: selected?.connection.id ?? null,
      status: selected?.connection.status ?? null,
      environmentId: selected?.environmentId ?? null,
      semanticLayerBaseUrl: selected
        ? configString(selected.connection, DBT_BASE_URL_CONFIG_KEY)
        : null,
      tokenConfigured,
      canManage: role === "owner" || role === "admin",
      connections: listed.map(({ connection, readiness }) => ({
        id: connection.id,
        label: connection.label,
        status: connection.status,
        readiness,
      })),
    };
  },
});
