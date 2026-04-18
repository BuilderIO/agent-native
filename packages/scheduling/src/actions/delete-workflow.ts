import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Delete a workflow and its steps",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    await assertAccess("workflow", args.id, "admin");
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .delete(schema.workflowSteps)
      .where(eq(schema.workflowSteps.workflowId, args.id));
    await getDb()
      .delete(schema.workflows)
      .where(eq(schema.workflows.id, args.id));
    return { ok: true };
  },
});
