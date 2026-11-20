import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";
import { requireDestination } from "./_folders.js";

export default defineAction({
  description:
    "Move a form to another workspace or into a folder of a workspace. Without folderId it lands at the top level of the workspace.",
  schema: z.object({
    id: z.string().describe("Form id"),
    workspaceId: z.string().describe("Destination workspace id"),
    folderId: z
      .string()
      .nullish()
      .describe("Destination folder id, which must belong to the workspace"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  run: async ({ id, workspaceId, folderId }) => {
    const access = formsAccess();
    await requireForm(access, id);
    await requireDestination(access, workspaceId, folderId);
    await getDb()
      .update(schema.forms)
      .set({ workspaceId, folderId: folderId ?? null, updatedAt: nowIso() })
      .where(eq(schema.forms.id, id));
    return { id };
  },
});
