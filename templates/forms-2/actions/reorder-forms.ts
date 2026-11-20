import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  formsAccess,
  formsErrors,
  orgScope,
  workspaceScope,
} from "./_access.js";
import { requireDestination } from "./_folders.js";

export default defineAction({
  description:
    "Set the manual order of the forms in a workspace, or in one of its folders: pass every form id of that list in the order wanted.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    folderId: z
      .string()
      .optional()
      .describe("Folder id; omit for forms at the top level of the workspace"),
    formIds: z
      .array(z.string())
      .min(1)
      .max(500)
      .describe("Form ids, first to last"),
  }),
  outputSchema: z.object({ updated: z.number() }),
  errors: formsErrors,
  run: async ({ workspaceId, folderId, formIds }) => {
    const access = formsAccess();
    await requireDestination(access, workspaceId, folderId);
    const { forms, workspaces } = schema;
    const db = getDb();
    const owned = await db
      .select({ id: forms.id })
      .from(forms)
      .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          orgScope(forms, access.orgId),
          eq(forms.workspaceId, workspaceId),
          inArray(forms.id, formIds),
        ),
      );
    const valid = new Set(owned.map((row) => row.id));
    const ordered = formIds.filter((id) => valid.has(id));
    await db.transaction(async (tx) => {
      for (const [position, id] of ordered.entries())
        await tx.update(forms).set({ position }).where(eq(forms.id, id));
    });
    return { updated: ordered.length };
  },
});
