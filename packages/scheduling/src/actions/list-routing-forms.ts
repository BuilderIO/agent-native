import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getSchedulingContext } from "../server/context.js";
import { assertTeamMember, currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "List routing forms visible to the current user — owned, shared, org-visible, or scoped to a team the user is a member of",
  schema: z.object({ teamId: z.string().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    if (!currentUserEmailOrNull()) return { forms: [] };
    if (args.teamId) {
      await assertTeamMember(args.teamId);
      const rows = await getDb()
        .select()
        .from(schema.routingForms)
        .where(
          and(
            eq(schema.routingForms.teamId, args.teamId),
            accessFilter(schema.routingForms, schema.routingFormShares),
          ),
        );
      return { forms: rows };
    }
    const rows = await getDb()
      .select()
      .from(schema.routingForms)
      .where(accessFilter(schema.routingForms, schema.routingFormShares));
    return { forms: rows };
  },
});
