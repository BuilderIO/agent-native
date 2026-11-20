import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, nowIso } from "./_access.js";
import { requireFolder } from "./_folders.js";

export default defineAction({
  description: "Rename a folder.",
  schema: z.object({
    id: z.string().describe("Folder id"),
    name: z.string().trim().min(1).max(120).describe("New name"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  run: async ({ id, name }) => {
    await requireFolder(formsAccess(), id);
    await getDb()
      .update(schema.folders)
      .set({ name, updatedAt: nowIso() })
      .where(eq(schema.folders.id, id));
    return { id };
  },
});
