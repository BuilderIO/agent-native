import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Delete a routing form and its responses",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .delete(schema.routingFormResponses)
      .where(eq(schema.routingFormResponses.formId, args.id));
    await getDb()
      .delete(schema.routingForms)
      .where(eq(schema.routingForms.id, args.id));
    return { ok: true };
  },
});
