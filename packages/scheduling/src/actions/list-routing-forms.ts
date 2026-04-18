import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "List routing forms visible to the current user — owned, shared, org-visible, or scoped to a team",
  schema: z.object({ teamId: z.string().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const email = currentUserEmailOrNull();
    const rows = args.teamId
      ? await getDb()
          .select()
          .from(schema.routingForms)
          .where(eq(schema.routingForms.teamId, args.teamId))
      : email
        ? await getDb()
            .select()
            .from(schema.routingForms)
            .where(accessFilter(schema.routingForms, schema.routingFormShares))
        : [];
    return { forms: rows };
  },
});
