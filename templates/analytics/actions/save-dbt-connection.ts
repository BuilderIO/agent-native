import { defineAction, fail } from "@agent-native/core/action";
import { hasAppSecret } from "@agent-native/core/secrets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  listWorkspaceConnections,
  resolveWorkspaceConnectionsForApp,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  DBT_BASE_URL_CONFIG_KEY,
  DBT_CONNECTION_LABEL,
  DBT_ENVIRONMENT_CONFIG_KEY,
  DBT_PROVIDER_ID,
  DBT_SEMANTIC_LAYER_TOKEN_KEY,
  validateEnvironmentId,
  validateSemanticLayerBaseUrl,
} from "../server/lib/dbt-connection.js";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials.js";

export default defineAction({
  description:
    "Save the organization's dbt Cloud Semantic Layer connection for Analytics: environment ID and GraphQL URL. The token is not an input; save it first as the org secret DBT_SEMANTIC_LAYER_TOKEN. Requires an organization owner or admin. Replaces the saved environment and URL, keeps the connection's app access, scopes, and groups.",
  schema: z.object({
    environmentId: z
      .string()
      .describe("dbt environment ID that holds the approved definitions."),
    semanticLayerBaseUrl: z
      .string()
      .describe("HTTPS Semantic Layer GraphQL URL on dbt.com or getdbt.com."),
  }),
  outputSchema: z.object({
    connectionId: z.string(),
    status: z.string(),
    environmentId: z.string(),
    semanticLayerBaseUrl: z.string(),
  }),
  run: async (input, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });

    const environment = validateEnvironmentId(input.environmentId);
    if (!environment.ok) {
      fail(environment.message, {
        errorCode: "dbt_environment_invalid",
        statusCode: 400,
      });
    }
    const baseUrl = validateSemanticLayerBaseUrl(input.semanticLayerBaseUrl);
    if (!baseUrl.ok) {
      fail(baseUrl.message, {
        errorCode: "dbt_base_url_invalid",
        statusCode: 400,
      });
    }

    const tokenConfigured = await hasAppSecret({
      key: DBT_SEMANTIC_LAYER_TOKEN_KEY,
      scope: "org",
      scopeId: admin.orgId,
    });
    if (!tokenConfigured) {
      fail(
        "Save the dbt Semantic Layer token in Settings before connecting dbt Cloud.",
        { errorCode: "dbt_token_required", statusCode: 409 },
      );
    }

    // Save only writes to a row this caller can use. With several such rows there
    // is no single target, so refuse rather than overwrite whichever lists first.
    const visible = await resolveWorkspaceConnectionsForApp({
      appId: ANALYTICS_APP_ID,
      provider: DBT_PROVIDER_ID,
      includeDisabled: true,
    });
    // A dbt row this caller cannot see may still exist for the org. Creating a new
    // row beside it would duplicate the connection, so refuse instead.
    const orgRows = await listWorkspaceConnections({
      provider: DBT_PROVIDER_ID,
      includeDisabled: true,
    });
    if (visible.length === 0 && orgRows.length > 0) {
      fail(
        "A dbt connection already exists for this organization that you cannot manage. Ask an organization admin to change it in Settings → Integrations.",
        { errorCode: "dbt_connection_restricted", statusCode: 409 },
      );
    }
    if (visible.length > 1) {
      fail(
        "Several dbt connections are granted to Analytics. Choose one in Settings → Integrations before saving.",
        { errorCode: "dbt_connection_ambiguous", statusCode: 409 },
      );
    }
    const existing = visible[0];

    // upsertWorkspaceConnection replaces these lists and account fields
    // outright, so anything omitted here is reset on every save.
    const connection = await upsertWorkspaceConnection({
      id: existing?.id,
      provider: DBT_PROVIDER_ID,
      label: existing?.label ?? DBT_CONNECTION_LABEL,
      accountId: existing?.accountId ?? null,
      accountLabel: existing?.accountLabel ?? null,
      status: "connected",
      scopes: existing?.scopes ?? [],
      config: {
        [DBT_BASE_URL_CONFIG_KEY]: baseUrl.value,
        [DBT_ENVIRONMENT_CONFIG_KEY]: environment.value,
      },
      allowedApps: existing?.allowedApps ?? [ANALYTICS_APP_ID],
      allowedUsers: existing?.allowedUsers ?? [],
      allowedUserGroups: existing?.allowedUserGroups ?? [],
      credentialRefs: [
        {
          key: DBT_SEMANTIC_LAYER_TOKEN_KEY,
          scope: "org",
          provider: DBT_PROVIDER_ID,
        },
      ],
    });

    return {
      connectionId: connection.id,
      status: connection.status,
      environmentId: environment.value,
      semanticLayerBaseUrl: baseUrl.value,
    };
  },
});
