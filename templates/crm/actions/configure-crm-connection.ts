import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createHubSpotCrmAdapter } from "../server/crm/hubspot-adapter.js";
import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope, toJson } from "./_crm-action-utils.js";

const idList = z.array(z.string().trim().min(1).max(160)).max(50).default([]);

export default defineAction({
  description:
    "Register an authorized HubSpot workspace Connection as a scoped CRM companion connection. Provider credentials remain in workspace Connections.",
  schema: z.object({
    workspaceConnectionId: z.string().trim().min(1).max(160).optional(),
    label: z.string().trim().min(1).max(160).default("HubSpot"),
    mode: z.enum(["connected", "hybrid"]).default("connected"),
    selectedPipelineIds: idList,
    selectedObjectTypes: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(50)
      .default(["companies", "contacts", "deals"]),
  }),
  audit: {
    target: (_args, result) => {
      const connection = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-connection",
        id: connection.id,
        ownerEmail: connection.ownerEmail,
        orgId: connection.orgId,
        visibility: connection.visibility,
      };
    },
    summary: (_args, result) =>
      `Configured CRM connection ${(result as { id?: string })?.id ?? ""}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const scope = requireCrmScope(ctx);
    const adapter = await createHubSpotCrmAdapter({
      connectionId: args.workspaceConnectionId,
      userEmail: scope.ownerEmail,
      orgId: scope.orgId,
    });
    const id = adapter.connection.connectionId;
    const db = getDb();
    const [existing] = await db
      .select({ id: schema.crmConnections.id })
      .from(schema.crmConnections)
      .where(
        and(
          eq(schema.crmConnections.workspaceConnectionId, id),
          accessFilter(schema.crmConnections, schema.crmConnectionShares),
        ),
      )
      .limit(1);
    const now = new Date().toISOString();
    const accessScopeKey = `workspace:${id}:${adapter.connection.actorId ?? scope.ownerEmail}`;
    const values = {
      provider: "hubspot" as const,
      workspaceConnectionId: id,
      label: args.label,
      accountId: adapter.connection.accountId ?? null,
      mode: args.mode,
      status: "connected" as const,
      selectedPipelinesJson: toJson(args.selectedPipelineIds, 8_000),
      selectedObjectTypesJson: toJson(args.selectedObjectTypes, 8_000),
      accessScopeKey,
      accessScopeJson: toJson(
        {
          key: accessScopeKey,
          actorId: adapter.connection.actorId,
          mode: adapter.connection.actorId ? "user" : "service-account",
          recordVisibility: adapter.connection.actorId ? "actor" : "unknown",
        },
        4_000,
      ),
      lastError: null,
      updatedAt: now,
    };
    const localId = existing?.id ?? id;

    if (existing) {
      await assertAccess("crm-connection", existing.id, "editor");
      await db
        .update(schema.crmConnections)
        .set(values)
        .where(
          and(
            eq(schema.crmConnections.id, existing.id),
            accessFilter(
              schema.crmConnections,
              schema.crmConnectionShares,
              undefined,
              "editor",
            ),
          ),
        );
    } else {
      await db.insert(schema.crmConnections).values({
        id: localId,
        ...values,
        ...scope,
        createdAt: now,
      });
    }

    return { id: localId, ...scope, provider: "hubspot" as const };
  },
});
