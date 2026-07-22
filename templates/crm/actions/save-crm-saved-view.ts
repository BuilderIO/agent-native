import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope, toJson } from "./_crm-action-utils.js";

const filterSchema = z.record(z.string().max(120), z.unknown());

export default defineAction({
  description:
    "Create or update a bounded, access-scoped CRM saved view. A saved view stores filters and presentation settings, never provider rows.",
  schema: z.object({
    id: z.string().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    kind: z.enum(["account", "person", "opportunity"]).optional(),
    filters: filterSchema.optional(),
    columns: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
    sort: z
      .array(
        z.object({
          field: z.string().trim().min(1).max(120),
          direction: z.enum(["asc", "desc"]),
        }),
      )
      .max(4)
      .optional(),
    dataProgramId: z.string().trim().min(1).max(128).optional(),
    pinned: z.boolean().optional(),
  }),
  audit: {
    target: (_args, result) => {
      const view = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-saved-view",
        id: view.id,
        ownerEmail: view.ownerEmail,
        orgId: view.orgId,
        visibility: view.visibility,
      };
    },
    summary: (args) => `Saved CRM view ${args.name}`,
  },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();
    if (args.id) {
      await assertAccess("crm-saved-view", args.id, "editor");
      await db
        .update(schema.crmSavedViews)
        .set({
          name: args.name,
          ...(args.description !== undefined
            ? { description: args.description }
            : {}),
          ...(args.kind !== undefined ? { kind: args.kind } : {}),
          ...(args.filters !== undefined
            ? { filtersJson: toJson(args.filters, 8_000) }
            : {}),
          ...(args.columns !== undefined
            ? { columnsJson: toJson(args.columns, 4_000) }
            : {}),
          ...(args.sort !== undefined
            ? { sortJson: toJson(args.sort, 2_000) }
            : {}),
          ...(args.dataProgramId !== undefined
            ? { dataProgramId: args.dataProgramId }
            : {}),
          ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
          updatedAt: now,
        })
        .where(eq(schema.crmSavedViews.id, args.id));
      const [view] = await db
        .select()
        .from(schema.crmSavedViews)
        .where(eq(schema.crmSavedViews.id, args.id))
        .limit(1);
      if (!view) throw new Error("CRM saved view was not found.");
      return view;
    }

    const scope = requireCrmScope(ctx);
    const id = crypto.randomUUID();
    await db.insert(schema.crmSavedViews).values({
      id,
      name: args.name,
      description: args.description ?? "",
      kind: args.kind ?? null,
      filtersJson: toJson(args.filters ?? {}, 8_000),
      columnsJson: toJson(args.columns ?? [], 4_000),
      sortJson: toJson(args.sort ?? [], 2_000),
      dataProgramId: args.dataProgramId ?? null,
      pinned: args.pinned ?? false,
      ...scope,
      createdAt: now,
      updatedAt: now,
    });
    const [view] = await db
      .select()
      .from(schema.crmSavedViews)
      .where(
        and(
          eq(schema.crmSavedViews.id, id),
          eq(schema.crmSavedViews.ownerEmail, scope.ownerEmail),
        ),
      )
      .limit(1);
    if (!view)
      throw new Error("CRM saved view could not be verified after saving.");
    return view;
  },
});
