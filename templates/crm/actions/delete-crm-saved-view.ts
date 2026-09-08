import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete one access-scoped saved CRM view and its shares. This removes a presentation setting only; it never deletes CRM records.",
  schema: z.object({
    id: z.string().trim().min(1).max(128),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("Reject the delete when the view changed since it was read."),
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
    summary: (args) => `Deleted CRM saved view ${args.id}`,
  },
  run: async (args) => {
    await assertAccess("crm-saved-view", args.id, "editor");
    const db = getDb();
    const [view] = await db
      .select()
      .from(schema.crmSavedViews)
      .where(eq(schema.crmSavedViews.id, args.id))
      .limit(1);
    if (!view) throw new Error("CRM saved view was not found.");
    if (
      args.expectedUpdatedAt !== undefined &&
      args.expectedUpdatedAt !== view.updatedAt
    ) {
      const error = new Error(
        `CRM saved view "${args.id}" changed since it was read (expected ${args.expectedUpdatedAt}, found ${view.updatedAt}).`,
      ) as Error & { statusCode?: number };
      error.statusCode = 409;
      throw error;
    }

    await db
      .delete(schema.crmSavedViews)
      .where(eq(schema.crmSavedViews.id, args.id));
    await db
      .delete(schema.crmSavedViewShares)
      .where(eq(schema.crmSavedViewShares.resourceId, args.id));
    // A dashboard-backed view keeps its data program: the program is a separate
    // shareable resource that other views may reference.
    return { ...view, deleted: true };
  },
});
