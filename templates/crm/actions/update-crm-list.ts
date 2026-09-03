import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { CrmListError, requireCrmList } from "./_crm-list-utils.js";

export default defineAction({
  description:
    "Update a CRM list's name, description, ordering, default view, or archived state. `api_slug` is immutable once assigned and cannot be changed here. Archiving hides the list; it never removes its entries or their records.",
  schema: z.object({
    listId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    archived: z.boolean().optional(),
    defaultViewId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .nullable()
      .optional()
      .describe("Saved view to open this list with. Pass null to clear it."),
  }),
  audit: {
    target: (_args, result) => {
      const list = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-list",
        id: list.id,
        ownerEmail: list.ownerEmail,
        orgId: list.orgId,
        visibility: list.visibility,
      };
    },
    summary: (args) => `Updated CRM list ${args.listId}`,
  },
  run: async (args) => {
    const db = getDb();
    await requireCrmList(db, args.listId, "editor");

    if (args.defaultViewId) {
      const [view] = await db
        .select({ id: schema.crmSavedViews.id })
        .from(schema.crmSavedViews)
        .where(
          and(
            eq(schema.crmSavedViews.id, args.defaultViewId),
            accessFilter(schema.crmSavedViews, schema.crmSavedViewShares),
          ),
        )
        .limit(1);
      if (!view) {
        throw new CrmListError(
          "crm-saved-view-not-found",
          `Saved view "${args.defaultViewId}" was not found or is not visible to you.`,
        );
      }
    }

    const now = new Date().toISOString();
    await db
      .update(schema.crmLists)
      .set({
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined
          ? { description: args.description }
          : {}),
        ...(args.position !== undefined ? { position: args.position } : {}),
        ...(args.archived !== undefined ? { archived: args.archived } : {}),
        ...(args.defaultViewId !== undefined
          ? { defaultViewId: args.defaultViewId }
          : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.crmLists.id, args.listId),
          accessFilter(
            schema.crmLists,
            schema.crmListShares,
            undefined,
            "editor",
          ),
        ),
      );

    return requireCrmList(db, args.listId, "viewer");
  },
});
