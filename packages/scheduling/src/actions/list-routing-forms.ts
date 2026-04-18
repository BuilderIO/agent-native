import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "List routing forms the current user owns",
  schema: z.object({ teamId: z.string().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const rows = args.teamId
      ? await getDb()
          .select()
          .from(schema.routingForms)
          .where(eq(schema.routingForms.teamId, args.teamId))
      : await getDb()
          .select()
          .from(schema.routingForms)
          .where(eq(schema.routingForms.ownerEmail, currentUserEmail()));
    return { forms: rows };
  },
});
