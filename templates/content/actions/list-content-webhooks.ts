import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentWebhookScopeForRow,
  resolveContentWebhookScope,
  serializeContentWebhook,
} from "./_content-webhooks.js";

const RECENT_DELIVERIES = 5;

export default defineAction({
  description:
    "List webhooks on a collection or page, with each one's last few deliveries (status, attempts, last response). Omit both IDs to list the webhooks you registered. Never returns signing secrets. Requires admin access to the collection or page.",
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  schema: z.object({
    databaseId: z
      .string()
      .optional()
      .describe("Collection ID whose webhooks to list"),
    documentId: z
      .string()
      .optional()
      .describe("Page ID whose webhooks to list"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const hooks = schema.contentWebhooks;
    let rows: Array<typeof hooks.$inferSelect>;
    if (args.databaseId || args.documentId) {
      const scope = await resolveContentWebhookScope(args);
      rows = await db
        .select()
        .from(hooks)
        .where(
          and(
            eq(hooks.scopeType, scope.scopeType),
            eq(hooks.scopeId, scope.scopeId),
          ),
        )
        .orderBy(desc(hooks.createdAt));
    } else {
      const userEmail = getRequestUserEmail()?.trim().toLowerCase();
      // guard:allow-bare-error — invariant: actions run for a signed-in caller
      if (!userEmail) throw new Error("no authenticated user");
      const created = await db
        .select()
        .from(hooks)
        .where(eq(hooks.createdBy, userEmail))
        .orderBy(desc(hooks.createdAt));
      rows = [];
      for (const row of created) {
        if (await contentWebhookScopeForRow(row)) rows.push(row);
      }
    }
    if (!rows.length) return { webhooks: [] };

    const deliveries = schema.contentWebhookDeliveries;
    const recent = await db
      .select()
      .from(deliveries)
      .where(
        inArray(
          deliveries.webhookId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(desc(deliveries.createdAt))
      .limit(rows.length * 50);
    return {
      webhooks: rows.map((row) =>
        serializeContentWebhook(
          row,
          recent
            .filter((delivery) => delivery.webhookId === row.id)
            .slice(0, RECENT_DELIVERIES),
        ),
      ),
    };
  },
});
