import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "Toggle whether a calendar is checked for conflicts",
  schema: z.object({
    credentialId: z.string(),
    externalId: z.string(),
    include: z.boolean(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    if (args.include) {
      const cred = await getDb()
        .select()
        .from(schema.schedulingCredentials)
        .where(eq(schema.schedulingCredentials.id, args.credentialId));
      if (!cred[0]) throw new Error("Credential not found");
      await getDb().insert(schema.selectedCalendars).values({
        id: nanoid(),
        credentialId: args.credentialId,
        userEmail: currentUserEmail(),
        externalId: args.externalId,
        integration: cred[0].type,
        createdAt: new Date().toISOString(),
      });
    } else {
      await getDb()
        .delete(schema.selectedCalendars)
        .where(
          and(
            eq(schema.selectedCalendars.credentialId, args.credentialId),
            eq(schema.selectedCalendars.externalId, args.externalId),
          ),
        );
    }
    return { ok: true };
  },
});
