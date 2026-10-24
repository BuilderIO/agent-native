import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, desc, eq, getTableColumns, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentWebhookScopeForRow,
  resolveContentWebhookScope,
  serializeContentWebhook,
} from "./_content-webhooks.js";

const RECENT_DELIVERIES = 5;
/** Without a scope, the caller's most recently created webhooks. */
const OWN_WEBHOOKS_LIMIT = 50;

export default defineAction({
  description:
    "List webhooks on a collection or page, with each one's last few deliveries (status, attempts, last response). Omit both IDs to list up to 50 of the webhooks you registered, newest first. Never returns signing secrets. Requires admin access to the collection or page.",
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
        .orderBy(desc(hooks.createdAt))
        .limit(OWN_WEBHOOKS_LIMIT);
      // Webhooks on the same collection or page share one access check.
      const scopeKey = (row: (typeof created)[number]) =>
        `${row.scopeType}:${row.scopeId}`;
      const manageable = new Map(
        await Promise.all(
          [...new Map(created.map((row) => [scopeKey(row), row])).values()].map(
            async (row) =>
              [
                scopeKey(row),
                Boolean(await contentWebhookScopeForRow(row)),
              ] as const,
          ),
        ),
      );
      rows = created.filter((row) => manageable.get(scopeKey(row)));
    }
    if (!rows.length) return { webhooks: [] };

    // The newest few per webhook, so a busy webhook can't push another's
    // failures out of the list.
    const deliveries = schema.contentWebhookDeliveries;
    const ranked = db
      .select({
        id: deliveries.id,
        rank: sql<number>`row_number() over (partition by ${deliveries.webhookId} order by ${deliveries.sequence} desc)`.as(
          "rank",
        ),
      })
      .from(deliveries)
      .where(
        inArray(
          deliveries.webhookId,
          rows.map((row) => row.id),
        ),
      )
      .as("ranked");
    const recent = await db
      .select(getTableColumns(deliveries))
      .from(deliveries)
      .innerJoin(ranked, eq(ranked.id, deliveries.id))
      .where(lte(ranked.rank, RECENT_DELIVERIES))
      .orderBy(desc(deliveries.sequence));
    return {
      webhooks: rows.map((row) =>
        serializeContentWebhook(
          row,
          recent.filter((delivery) => delivery.webhookId === row.id),
        ),
      ),
    };
  },
});
