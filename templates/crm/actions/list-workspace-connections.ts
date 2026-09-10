import { defineAction } from "@agent-native/core/action";
import { listWorkspaceConnectionsForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { CRM_APP_ID } from "../server/lib/provider-api.js";

const httpBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (["true", "1"].includes(value.toLowerCase())) return true;
  if (["false", "0"].includes(value.toLowerCase())) return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "List safe metadata for HubSpot and Salesforce workspace connections currently granted to CRM. Provider credentials and credential references are never returned.",
  schema: z.object({
    includeDisabled: httpBoolean.default(false),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ includeDisabled }) => {
    const connectionGroups = await Promise.all(
      (["hubspot", "salesforce"] as const).map((provider) =>
        listWorkspaceConnectionsForApp({
          appId: CRM_APP_ID,
          provider,
          includeDisabled,
        }),
      ),
    );
    const connections = connectionGroups.flat();
    return {
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        accountId: connection.accountId,
        accountLabel: connection.accountLabel,
        status: connection.status,
        lastCheckedAt: connection.lastCheckedAt,
        lastUsedAt: connection.lastUsedAt,
        accessMode: connection.appAccess.mode,
      })),
    };
  },
});
