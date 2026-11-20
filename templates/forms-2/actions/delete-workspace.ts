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
  description:
    "Move a workspace to the Trash. Its forms stay inside it and come back when it is restored.",
  schema: z.object({ id: z.string().describe("Workspace id") }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const access = formsAccess();
    await requireWorkspace(access, id);
    const now = nowIso();
    await getDb()
      .update(schema.workspaces)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.workspaces.id, id));
    return { id };
  },
});
