import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { assertTeamAdmin } from "./_helpers.js";

export default defineAction({
  description: "Invite a user to a team",
  schema: z.object({
    teamId: z.string(),
    email: z.string(),
    role: z.enum(["owner", "admin", "member"]).default("member"),
  }),
  run: async (args) => {
    await assertTeamAdmin(args.teamId);
    const { getDb, schema } = getSchedulingContext();
    const token = nanoid(24);
    const id = nanoid();
    await getDb().insert(schema.teamMembers).values({
      id,
      teamId: args.teamId,
      userEmail: args.email,
      role: args.role,
      accepted: false,
      inviteToken: token,
      invitedAt: new Date().toISOString(),
    });
    return { inviteToken: token, memberId: id };
  },
});
