import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Toggle a workflow's disabled state",
  schema: z.object({ id: z.string(), disabled: z.boolean().optional() }),
  run: async (args) => {
    await assertAccess("workflow", args.id, "editor");
    const { getDb, schema } = getSchedulingContext();
    const rows = await getDb()
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.id, args.id));
    if (!rows[0]) throw new Error("Workflow not found");
    const newDisabled = args.disabled ?? !rows[0].disabled;
    await getDb()
      .update(schema.workflows)
      .set({ disabled: newDisabled, updatedAt: new Date().toISOString() })
      .where(eq(schema.workflows.id, args.id));
    return { disabled: newDisabled };
  },
});
