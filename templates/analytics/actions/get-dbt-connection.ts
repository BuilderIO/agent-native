import { defineAction, fail } from "@agent-native/core/action";
import { hasAppSecret } from "@agent-native/core/secrets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { listWorkspaceConnectionsForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { resolveOrgRole } from "../server/lib/db-admin-connections.js";
import {
  DBT_BASE_URL_CONFIG_KEY,
  DBT_ENVIRONMENT_CONFIG_KEY,
  DBT_PROVIDER_ID,
  DBT_SEMANTIC_LAYER_TOKEN_KEY,
} from "../server/lib/dbt-connection.js";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials.js";

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
    "Read the organization's dbt Cloud Semantic Layer connection for Analytics: status, environment ID, GraphQL URL, and whether the token is saved. Never returns the token value. Missing connection returns connected false with nulls. Read-only.",
  schema: z.object({}),
  outputSchema: z.object({
    connected: z.boolean(),
    connectionId: z.string().nullable(),
    status: z
      .enum(["connected", "checking", "needs_reauth", "error", "disabled"])
      .nullable(),
    environmentId: z.string().nullable(),
    semanticLayerBaseUrl: z.string().nullable(),
    tokenConfigured: z.boolean(),
    canManage: z.boolean(),
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
    const connection = connections[0] ?? null;

    return {
      // A removed token leaves the row's status "connected", so the token must gate it too.
      connected: connection?.status === "connected" && tokenConfigured,
      connectionId: connection?.id ?? null,
      status: connection?.status ?? null,
      environmentId: configString(connection, DBT_ENVIRONMENT_CONFIG_KEY),
      semanticLayerBaseUrl: configString(connection, DBT_BASE_URL_CONFIG_KEY),
      tokenConfigured,
      canManage: role === "owner" || role === "admin",
    };
  },
});
