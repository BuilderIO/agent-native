import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hydrateSavedViewRow } from "../server/lib/crm-query.js";

export default defineAction({
  description:
    "List access-scoped saved CRM views with their stored filter, sort, columns, board grouping, audience, and optional linked data-program ID.",
  schema: z.object({
    viewKind: z.enum(["table", "board"]).optional(),
    targetKind: z.enum(["object", "list"]).optional(),
    targetId: z.string().trim().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => {
    const conditions = [
      accessFilter(schema.crmSavedViews, schema.crmSavedViewShares),
    ];
    if (input.viewKind) {
      conditions.push(eq(schema.crmSavedViews.viewKind, input.viewKind));
    }
    if (input.targetKind) {
      conditions.push(eq(schema.crmSavedViews.targetKind, input.targetKind));
    }
    if (input.targetId) {
      conditions.push(eq(schema.crmSavedViews.targetId, input.targetId));
    }
    const rows = await getDb()
      .select()
      .from(schema.crmSavedViews)
      .where(and(...conditions))
      .orderBy(
        desc(schema.crmSavedViews.pinned),
        desc(schema.crmSavedViews.updatedAt),
      )
      .limit(input.limit);

    return {
      views: rows.map((row) => {
        const view = hydrateSavedViewRow(row);
        return {
          id: view.id,
          name: view.name,
          description: view.description || undefined,
          kind: view.kind ?? undefined,
          viewKind: view.viewKind,
          targetKind: view.targetKind,
          targetId: view.targetId ?? undefined,
          groupByAttributeId: view.groupByAttributeId ?? undefined,
          filters: view.filter,
          sort: view.sort,
          columns: view.columns,
          dataProgramId: view.dataProgramId ?? undefined,
          pinned: view.pinned,
          audience: view.audience,
          updatedAt: view.updatedAt,
        };
      }),
    };
  },
});
