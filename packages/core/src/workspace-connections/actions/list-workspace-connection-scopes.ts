import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { resolveWorkspaceConnectionsForApp } from "../store.js";

const CONNECTION_SCOPES = ["user", "organization", "app"] as const;

const connectionScopesSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string(),
  accountLabel: z.string().nullable(),
  status: z.string(),
  connectionScope: z.enum(CONNECTION_SCOPES).nullable(),
  ownedByCaller: z.boolean(),
  grantedScopes: z.array(z.string()),
});

const listWorkspaceConnectionScopesResultSchema = z.object({
  connections: z.array(connectionScopesSchema),
  hint: z.string(),
});

type ListWorkspaceConnectionScopesResult = z.infer<
  typeof listWorkspaceConnectionScopesResultSchema
>;

const MISSING_SCOPE_HINT =
  "Granted scopes come from the provider's OAuth app (for HubSpot, the scopes configured on the HubSpot app). To use an API that needs a scope missing here, ask the provider admin to add it to that app, then reconnect. A connection made before its granted scopes were recorded can show an older list; reconnecting refreshes it.";

function connectionScopeOf(
  config: Record<string, unknown>,
): (typeof CONNECTION_SCOPES)[number] | null {
  const value = config.workspaceConnectionScope;
  return CONNECTION_SCOPES.find((scope) => scope === value) ?? null;
}

export default defineAction({
  description:
    'List the OAuth scopes a provider (e.g. "hubspot") granted to each of its workspace connections this app can use for the current user. Check grantedScopes before calling an API that needs a write or other specific scope; if one is missing, tell the user to ask their provider admin to add it to the OAuth app and reconnect, rather than retrying. connectionScope "user" means a personal connection; ownedByCaller says whether it belongs to the current user. Never returns tokens or other users\' details.',
  schema: z.object({
    provider: z
      .string()
      .min(1)
      .describe('Workspace connection provider id, e.g. "hubspot".'),
  }),
  outputSchema: listWorkspaceConnectionScopesResultSchema,
  http: { method: "GET" },
  readOnly: true,
  // Connections are per user, so a shared browser cache must not keep them.
  persistInBrowser: false,
  run: async (args, ctx): Promise<ListWorkspaceConnectionScopesResult> => {
    const appId =
      ctx?.appId?.trim() ||
      fail("Listing connection scopes needs the calling app.", {
        errorCode: "app_required",
        statusCode: 400,
      });
    const caller = ctx?.userEmail?.trim().toLowerCase();
    const connections = await resolveWorkspaceConnectionsForApp({
      appId,
      provider: args.provider,
    });
    return {
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        accountLabel: connection.accountLabel,
        status: connection.status,
        connectionScope: connectionScopeOf(connection.config),
        ownedByCaller:
          !!caller && connection.ownerEmail.trim().toLowerCase() === caller,
        grantedScopes: [...connection.scopes],
      })),
      hint: MISSING_SCOPE_HINT,
    };
  },
});
