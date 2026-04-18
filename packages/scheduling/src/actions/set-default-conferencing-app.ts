import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "Mark a video app credential as the user's default",
  schema: z.object({ credentialId: z.string() }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const email = currentUserEmail();
    const allVideo = await getDb()
      .select()
      .from(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.userEmail, email));
    for (const c of allVideo) {
      await getDb()
        .update(schema.schedulingCredentials)
        .set({ isDefault: c.id === args.credentialId })
        .where(eq(schema.schedulingCredentials.id, c.id));
    }
    return { ok: true };
  },
});
