import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Accept a pending team invite by token",
  schema: z.object({ token: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const rows = await getDb()
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.inviteToken, args.token));
    if (!rows[0]) throw new Error("Invite not found or already used");
    await getDb()
      .update(schema.teamMembers)
      .set({
        accepted: true,
        joinedAt: new Date().toISOString(),
        inviteToken: null,
      })
      .where(eq(schema.teamMembers.id, rows[0].id));
    return { teamId: rows[0].teamId };
  },
});
