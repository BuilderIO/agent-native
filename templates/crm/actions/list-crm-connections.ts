import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * The object types a connection mirrors. An unreadable blob is not reported as
 * "mirrors nothing": the settings UI would then render an empty target picker,
 * which is indistinguishable from a correctly configured CRM that happens to
 * have no objects.
 */
function parseObjectTypes(connectionId: string, raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `CRM connection ${connectionId} has an unreadable selected_object_types_json. Repair it before reading this connection.`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  ) {
    throw new Error(
      `CRM connection ${connectionId} has a selected_object_types_json that is not a list of object types.`,
    );
  }
  return parsed as string[];
}

export default defineAction({
  description:
    "List the access-scoped CRM connections with their mode, health, and mirrored object types. Use it to discover which object types a connection carries before reading or authoring attributes on them. The mode `hybrid` is deprecated and only ever appears on connections configured before per-attribute authority replaced it.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const rows = await getDb()
      .select({
        id: schema.crmConnections.id,
        provider: schema.crmConnections.provider,
        label: schema.crmConnections.label,
        accountId: schema.crmConnections.accountId,
        mode: schema.crmConnections.mode,
        status: schema.crmConnections.status,
        selectedObjectTypesJson: schema.crmConnections.selectedObjectTypesJson,
        lastSyncedAt: schema.crmConnections.lastSyncedAt,
        lastError: schema.crmConnections.lastError,
        updatedAt: schema.crmConnections.updatedAt,
      })
      .from(schema.crmConnections)
      .where(accessFilter(schema.crmConnections, schema.crmConnectionShares))
      .orderBy(desc(schema.crmConnections.updatedAt))
      .limit(args.limit);

    return {
      connections: rows.map(({ selectedObjectTypesJson, ...row }) => ({
        ...row,
        objectTypes: parseObjectTypes(row.id, selectedObjectTypesJson),
      })),
    };
  },
});
