import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  formsAccess,
  formsErrors,
  nowIso,
  requireWorkspace,
} from "./_access.js";

export default defineAction({
  description: "Rename a workspace or change its position in the list.",
  schema: z.object({
    id: z.string().describe("Workspace id"),
    name: z.string().trim().min(1).max(120).optional().describe("New name"),
    position: z.number().int().min(0).optional().describe("New list position"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  run: async ({ id, name, position }) => {
    const access = formsAccess();
    await requireWorkspace(access, id);
    await getDb()
      .update(schema.workspaces)
      .set({
        ...(name === undefined ? {} : { name }),
        ...(position === undefined ? {} : { position }),
        updatedAt: nowIso(),
      })
      .where(eq(schema.workspaces.id, id));
    return { id };
  },
});
