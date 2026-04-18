import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { assertTeamAdmin } from "./_helpers.js";

export default defineAction({
  description: "Remove a user from a team",
  schema: z.object({ teamId: z.string(), email: z.string() }),
  run: async (args) => {
    await assertTeamAdmin(args.teamId);
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .delete(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, args.teamId),
          eq(schema.teamMembers.userEmail, args.email),
        ),
      );
    return { ok: true };
  },
});
