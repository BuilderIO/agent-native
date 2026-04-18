import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { assertTeamAdmin } from "./_helpers.js";

export default defineAction({
  description: "Update a team member's role",
  schema: z.object({
    teamId: z.string(),
    email: z.string(),
    role: z.enum(["owner", "admin", "member"]),
  }),
  run: async (args) => {
    await assertTeamAdmin(args.teamId);
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .update(schema.teamMembers)
      .set({ role: args.role })
      .where(
        and(
          eq(schema.teamMembers.teamId, args.teamId),
          eq(schema.teamMembers.userEmail, args.email),
        ),
      );
    return { ok: true };
  },
});
