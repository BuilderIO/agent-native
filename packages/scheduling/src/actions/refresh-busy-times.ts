import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description:
    "Bust the calendar cache for a user (force fresh busy-time lookup)",
  schema: z.object({ userEmail: z.string().optional() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const email = args.userEmail ?? currentUserEmail();
    // Delete cache rows for all of this user's credentials
    const creds = await getDb()
      .select({ id: schema.schedulingCredentials.id })
      .from(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.userEmail, email));
    for (const c of creds) {
      await getDb()
        .delete(schema.calendarCache)
        .where(eq(schema.calendarCache.credentialId, c.id));
    }
    return { ok: true, credentialsBusted: creds.length };
  },
});
