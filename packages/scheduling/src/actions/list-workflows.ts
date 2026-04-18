import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "List workflows owned by the current user or a team",
  schema: z.object({ teamId: z.string().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const email = currentUserEmail();
    const rows = args.teamId
      ? await getDb()
          .select()
          .from(schema.workflows)
          .where(eq(schema.workflows.teamId, args.teamId))
      : await getDb()
          .select()
          .from(schema.workflows)
          .where(eq(schema.workflows.ownerEmail, email));
    return { workflows: rows };
  },
});
