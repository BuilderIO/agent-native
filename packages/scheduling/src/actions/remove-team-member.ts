import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getSchedulingContext } from "../server/context.js";
import { assertTeamAdmin } from "./_helpers.js";

export default defineAction({
  description: "Remove a user from a team",
  schema: z.object({ teamId: z.string(), email: z.string() }),
  // It changes who may use an app or what they may do in it: every call
  // needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
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
