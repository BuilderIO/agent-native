import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getSchedulingContext } from "../server/context.js";
import { assertTeamMember, currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "List workflows visible to the current user — owned, shared, org-visible, or scoped to a team the user is a member of",
  schema: z.object({ teamId: z.string().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    if (!currentUserEmailOrNull()) return { workflows: [] };
    if (args.teamId) {
      await assertTeamMember(args.teamId);
      const rows = await getDb()
        .select()
        .from(schema.workflows)
        .where(
          and(
            eq(schema.workflows.teamId, args.teamId),
            accessFilter(schema.workflows, schema.workflowShares),
          ),
        );
      return { workflows: rows };
    }
    const rows = await getDb()
      .select()
      .from(schema.workflows)
      .where(accessFilter(schema.workflows, schema.workflowShares));
    return { workflows: rows };
  },
});
